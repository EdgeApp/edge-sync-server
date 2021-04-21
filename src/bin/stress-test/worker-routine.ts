import { randomInt } from 'crypto'

import { asTimestampRev, TimestampRev } from '../../types'
import { delay } from '../../util/utils'
import { SyncClient } from './SyncClient'
import {
  asWorkerConfig,
  CheckEvent,
  ReadyEvent,
  UpdateEvent,
  WorkerConfig
} from './types'
import {
  isAcceptableError,
  isRepoNotFoundError,
  randomElement,
  send,
  throttle
} from './utils/utils'

process.title = 'worker'

// State
let updatesDone = 0
let lastUpdateTimestamp: TimestampRev = asTimestampRev(0)
let isRepoSynced: boolean = true

// Main Function
export async function workerRoutine(config: WorkerConfig): Promise<void> {
  // Create sync clients
  const syncClients = Object.entries(config.clusters).reduce<SyncClient[]>(
    (syncClients, [clusterName, urls]) => {
      const clients = urls.map(
        serverUrl => new SyncClient(serverUrl, clusterName)
      )
      return [...syncClients, ...clients]
    },
    []
  )

  // Create repos
  await getRepoReady(randomElement(syncClients), config.syncKey)

  // Run updater
  updater(config, syncClients).catch(errHandler)

  // Run the checker
  checker(config, syncClients).catch(errHandler)
}

// Creates repo if it does not exist.
const getRepoReady = async (
  sync: SyncClient,
  syncKey: string
): Promise<void> => {
  try {
    const response = await sync.createRepo(syncKey)
    const requestTime = Date.now()
    const serverRepoTimestamp: TimestampRev = response.data.timestamp

    lastUpdateTimestamp = serverRepoTimestamp

    const workerOutput: ReadyEvent = {
      type: 'ready',
      serverHost: sync.host,
      syncKey,
      requestTime,
      serverRepoTimestamp
    }

    send(workerOutput)
  } catch (error) {
    if (error?.response?.message !== 'Datastore already exists') {
      throw error
    }

    const response = await sync.getUpdates(syncKey)
    const requestTime = Date.now()
    const serverRepoTimestamp = response.data.timestamp

    const workerOutput: ReadyEvent = {
      type: 'ready',
      serverHost: sync.host,
      syncKey,
      requestTime,
      serverRepoTimestamp
    }

    send(workerOutput)
  }
}

const updater = (
  config: WorkerConfig,
  syncClients: SyncClient[]
): Promise<void> => {
  return updateRepo(config, syncClients)
    .then(send)
    .then(() => {
      if (
        config.maxUpdatesPerRepo === 0 ||
        updatesDone < config.maxUpdatesPerRepo
      ) {
        return delay((60 / config.repoUpdatesPerMin) * 1000).then(() =>
          updater(config, syncClients)
        )
      }
    })
}

async function updateRepo(
  config: WorkerConfig,
  syncClients: SyncClient[]
): Promise<UpdateEvent> {
  const sync = randomElement(syncClients)

  const serverHost = sync.host
  const syncKey = config.syncKey

  const fileCount = randomInt(
    config.fileCountRange[0],
    config.fileCountRange[1] + 1
  )
  const changeSet = await sync.randomChangeSet(
    syncKey,
    fileCount,
    config.fileByteSizeRange
  )
  const payloadSize = Buffer.byteLength(JSON.stringify(changeSet))

  try {
    // Make sure the worker is up-to-date with the repo in order to successfully
    // write update.
    await sync.getUpdates(syncKey)

    // Write update
    const response = await sync.updateFiles(syncKey, changeSet)

    const serverRepoTimestamp = response.data.timestamp
    const requestTime = Date.now()

    lastUpdateTimestamp = serverRepoTimestamp

    ++updatesDone

    return {
      type: 'update',
      serverHost,
      syncKey,
      requestTime,
      serverRepoTimestamp,
      payloadSize
    }
  } catch (error) {
    if (!isAcceptableError(error)) {
      throw error
    }

    // Try again
    return await throttle(() => updateRepo(config, syncClients), 500)
  }
}

const checker = async (
  config: WorkerConfig,
  syncClients: SyncClient[]
): Promise<void> => {
  await delay((60 / config.repoReadsPerMin) * 1000)

  return await Promise.all(
    // Only check for updates on servers where the client's timestamp does
    // not equal the last update timestamp. This prevents redundant checks.
    syncClients
      .filter(
        syncClient =>
          syncClient.repoTimestamps[config.syncKey] !== lastUpdateTimestamp
      )
      .map(sync => checkServerStatus({ sync, syncKey: config.syncKey }))
  )
    .then(checkResponses => {
      const checkEvents = checkResponses.filter(
        (checkResponse): checkResponse is CheckEvent => checkResponse != null
      )
      checkEvents.forEach(checkEvent => {
        send(checkEvent)
      })

      const serverRepoTimestamps = checkEvents.map(
        checkEvent => checkEvent.serverRepoTimestamp
      )

      const wasRepoSynced = isRepoSynced

      // Update State
      isRepoSynced = serverRepoTimestamps.every(
        serverRepoTimestamp => serverRepoTimestamp === lastUpdateTimestamp
      )

      // If repo has become synced across all servers, then increase update rate
      if (!wasRepoSynced && isRepoSynced) {
        config.repoUpdatesPerMin =
          config.repoUpdatesPerMin * config.repoUpdateIncreaseRate
      }
    })
    .then(() => {
      if (
        config.maxUpdatesPerRepo === 0 ||
        updatesDone < config.maxUpdatesPerRepo ||
        !isRepoSynced
      ) {
        return checker(config, syncClients)
      }
    })
}

interface CheckServerStatusProps {
  sync: SyncClient
  syncKey: string
}

async function checkServerStatus({
  sync,
  syncKey
}: CheckServerStatusProps): Promise<CheckEvent | undefined> {
  const requestTime = Date.now()

  try {
    const response = await sync.getUpdates(syncKey)

    const serverRepoTimestamp: TimestampRev = response.data.timestamp

    return {
      type: 'check',
      serverHost: sync.host,
      syncKey,
      requestTime,
      serverRepoTimestamp
    }
  } catch (error) {
    if (!isAcceptableError(error)) {
      throw error
    }

    if (isRepoNotFoundError(error)) {
      return {
        type: 'check',
        serverHost: sync.host,
        syncKey,
        requestTime,
        serverRepoTimestamp: asTimestampRev(0)
      }
    }

    send(error)
  }
}

// Startup:

if (require.main === module) {
  try {
    const jsonArg = process.argv[2]

    if (jsonArg == null) {
      throw new Error('Missing json config argument.')
    }

    let config: WorkerConfig

    try {
      config = asWorkerConfig(JSON.parse(jsonArg))
    } catch (error) {
      if (error instanceof Error)
        throw new Error(`Invalid JSON config argument: ${error.message}`)
      throw error
    }

    workerRoutine(config).catch(errHandler)
  } catch (error) {
    if (error instanceof TypeError) {
      send(new Error(`Invalid JSON config argument: ${error.message}`))
    } else {
      send(error)
    }
  }

  process.on('unhandledRejection', error => {
    send(`UNHANDLED PROMISE!!!`)
    if (error instanceof Error) errHandler(error)
  })
}

function errHandler(err: Error): void {
  send(err)
  process.exit(1)
}
