import { randomInt } from 'crypto'

import { SyncClient } from './SyncClient'
import {
  asWorkerConfig,
  CheckEvent,
  ReadyEvent,
  UpdateEvent,
  WorkerConfig
} from './types'
import {
  delay,
  isAcceptableError,
  isRepoNotFoundError,
  randomElement,
  send,
  throttle
} from './utils/utils'

process.title = 'worker'

// State
let updatesDone = 0
let lastUpdateHash = ''
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

  // Run reader
  reader(config, syncClients).catch(errHandler)

  // Run the checker
  checker(config, syncClients).catch(errHandler)
}

// Creates repo if it does not exist.
const getRepoReady = async (
  sync: SyncClient,
  syncKey: string
): Promise<void> => {
  try {
    await sync.createRepo(syncKey)
    const requestTime = Date.now()
    const serverRepoHash: string = ''

    lastUpdateHash = serverRepoHash

    const workerOutput: ReadyEvent = {
      type: 'ready',
      serverHost: sync.host,
      syncKey,
      requestTime,
      serverRepoHash
    }

    send(workerOutput)
  } catch (error) {
    if (error?.response?.message !== 'Datastore already exists') {
      throw error
    }

    const response = await sync.getUpdates(syncKey)
    const requestTime = Date.now()
    const serverRepoHash = response.hash

    const workerOutput: ReadyEvent = {
      type: 'ready',
      serverHost: sync.host,
      syncKey,
      requestTime,
      serverRepoHash
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
      if (isMaxUpdatesReach(config)) {
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
    const serverRepoHash = response.hash
    const requestTime = Date.now()

    lastUpdateHash = serverRepoHash

    ++updatesDone

    return {
      type: 'update',
      serverHost,
      syncKey,
      requestTime,
      serverRepoHash,
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

const reader = (
  config: WorkerConfig,
  syncClients: SyncClient[]
): Promise<void> => {
  return readRepo(config, syncClients)
    .then(send)
    .then(() => {
      if (isMaxUpdatesReach(config)) {
        return delay((60 / config.repoReadsPerMin) * 1000).then(() =>
          reader(config, syncClients)
        )
      }
    })
}

async function readRepo(
  config: WorkerConfig,
  syncClients: SyncClient[]
): Promise<CheckEvent> {
  const sync = randomElement(syncClients)
  const serverHost = sync.host
  const syncKey = config.syncKey

  try {
    // Read repo
    const response = await sync.getUpdates(syncKey)
    const serverRepoHash = response.hash
    const requestTime = Date.now()

    lastUpdateHash = serverRepoHash

    // Send a check event just because we can.
    // We might as well use the response to help with metrics.
    return {
      type: 'check',
      serverHost,
      syncKey,
      requestTime,
      serverRepoHash
    }
  } catch (error) {
    if (!isAcceptableError(error)) {
      throw error
    }

    // Try again
    return await throttle(() => readRepo(config, syncClients), 500)
  }
}

const checker = async (
  config: WorkerConfig,
  syncClients: SyncClient[]
): Promise<void> => {
  await delay(config.repoCheckDelayInSeconds * 1000)

  return await Promise.all(
    // Only check for updates on servers where the client's hash does
    // not equal the last update hash. This prevents redundant checks.
    syncClients
      .filter(
        syncClient => syncClient.repoHashes[config.syncKey] !== lastUpdateHash
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

      const serverRepoHashes = checkEvents.map(
        checkEvent => checkEvent.serverRepoHash
      )

      const wasRepoSynced = isRepoSynced

      // Update State
      isRepoSynced = serverRepoHashes.every(
        serverRepoHash => serverRepoHash === lastUpdateHash
      )

      // If repo has become synced across all servers, then increase update rate
      if (!wasRepoSynced && isRepoSynced) {
        config.repoUpdatesPerMin =
          config.repoUpdatesPerMin * config.repoUpdateIncreaseRate
      }
    })
    .then(() => {
      if (isMaxUpdatesReach(config) || !isRepoSynced) {
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

    const serverRepoHash: string = response.hash

    return {
      type: 'check',
      serverHost: sync.host,
      syncKey,
      requestTime,
      serverRepoHash
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
        serverRepoHash: ''
      }
    }

    send(error)
  }
}

function isMaxUpdatesReach(config: WorkerConfig): boolean {
  return (
    config.maxUpdatesPerRepo === 0 || updatesDone < config.maxUpdatesPerRepo
  )
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
