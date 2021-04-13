import { randomInt } from 'crypto'
import Semaphore from 'semaphore-async-await'

import { asTimestampRev, TimestampRev } from '../../types'
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
let updatesQueued = 0
let updatesDone = 0
let lastUpdateTimestamp: TimestampRev = asTimestampRev(0)
let isRepoSynced: boolean = true

// State Methods
const repoUpdateIsSynced = (
  serverRepoTimestamps: string[],
  config: WorkerConfig
): void => {
  const isSynced = serverRepoTimestamps.every(
    serverRepoTimestamp => serverRepoTimestamp === lastUpdateTimestamp
  )

  // If repo is has synced across all servers, then increase update rate
  if (!isRepoSynced && isSynced) {
    config.repoUpdatesPerMin =
      config.repoUpdatesPerMin * config.repoUpdateIncreaseRate
  }

  // Update state
  isRepoSynced = isSynced
}

// Main Function
export async function workerRoutine(config: WorkerConfig): Promise<void> {
  const updateLock = new Semaphore(1)
  const readLock = new Semaphore(1)

  const getUpdateDelay = (): number => (60 / config.repoUpdatesPerMin) * 1000
  const updateLockReleaser = (): void => {
    updateLock.release()

    if (
      config.maxUpdatesPerRepo === 0 ||
      updatesDone + 1 < config.maxUpdatesPerRepo
    ) {
      setTimeout(updateLockReleaser, getUpdateDelay())
    }
  }
  const getReadLockDelay = (): number => (60 / config.repoReadsPerMin) * 1000
  const readLockReleaser = (): void => {
    readLock.release()

    if (
      config.maxUpdatesPerRepo === 0 ||
      updatesDone + 1 < config.maxUpdatesPerRepo
    ) {
      setTimeout(readLockReleaser, getReadLockDelay())
    }
  }
  // Initialize lock releasers
  updateLock.drainPermits()
  updateLockReleaser()
  readLock.drainPermits()
  readLockReleaser()

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
  await getRepoReady(randomElement(syncClients), config.repoId)

  // Run updater
  updater(config, syncClients, updateLock, readLock).catch(errHandler)

  // Run the checker
  checker(config, syncClients, readLock).catch(errHandler)
}

// Creates repo if it does not exist.
const getRepoReady = async (
  sync: SyncClient,
  repoId: string
): Promise<void> => {
  try {
    const response = await sync.createRepo(repoId)
    const requestTime = Date.now()
    const serverRepoTimestamp: TimestampRev = response.data.timestamp

    lastUpdateTimestamp = serverRepoTimestamp

    const workerOutput: ReadyEvent = {
      type: 'ready',
      serverHost: sync.host,
      repoId,
      requestTime,
      serverRepoTimestamp
    }

    send(workerOutput)
  } catch (error) {
    if (error?.response?.message !== 'Datastore already exists') {
      throw error
    }

    const response = await sync.getUpdates(repoId)
    const requestTime = Date.now()
    const serverRepoTimestamp = response.data.timestamp

    const workerOutput: ReadyEvent = {
      type: 'ready',
      serverHost: sync.host,
      repoId,
      requestTime,
      serverRepoTimestamp
    }

    send(workerOutput)
  }
}

const updater = (
  config: WorkerConfig,
  syncClients: SyncClient[],
  updateLock: Semaphore,
  readLock: Semaphore
): Promise<void> => {
  return updateRepo(config, syncClients, updateLock)
    .then(send)
    .then(() => {
      readLock.release()
      if (
        config.maxUpdatesPerRepo === 0 ||
        updatesQueued < config.maxUpdatesPerRepo
      ) {
        ++updatesQueued
        return updater(config, syncClients, updateLock, readLock)
      }
    })
}

async function updateRepo(
  config: WorkerConfig,
  syncClients: SyncClient[],
  updateLock: Semaphore
): Promise<UpdateEvent> {
  await updateLock.acquire()

  const sync = randomElement(syncClients)

  const serverHost = sync.host
  const repoId = config.repoId

  const fileCount = randomInt(
    config.fileCountRange[0],
    config.fileCountRange[1] + 1
  )
  const changeSet = await sync.randomChangeSet(
    repoId,
    fileCount,
    config.fileByteSizeRange
  )
  const payloadSize = Buffer.byteLength(JSON.stringify(changeSet))

  try {
    // Make sure the worker is up-to-date with the repo in order to successfully
    // write update.
    await sync.getUpdates(repoId)

    // Write update
    const response = await sync.updateFiles(repoId, changeSet)

    const serverRepoTimestamp = response.data.timestamp
    const requestTime = Date.now()

    lastUpdateTimestamp = serverRepoTimestamp

    ++updatesDone

    return {
      type: 'update',
      serverHost,
      repoId,
      requestTime,
      serverRepoTimestamp,
      payloadSize
    }
  } catch (error) {
    if (!isAcceptableError(error)) {
      throw error
    }

    // Try again
    updateLock.release()
    return await throttle(
      () => updateRepo(config, syncClients, updateLock),
      500
    )
  }
}

const checker = (
  config: WorkerConfig,
  syncClients: SyncClient[],
  readLock: Semaphore
): Promise<void> =>
  readLock
    .acquire()
    .then(() =>
      Promise.all(
        // Only check for updates on servers where the client's timestamp does
        // not equal the last update timestamp. This prevents redundant checks.
        syncClients
          .filter(
            syncClient =>
              syncClient.repoTimestamps[config.repoId] !== lastUpdateTimestamp
          )
          .map(sync => checkServerStatus({ sync, repoId: config.repoId }))
      )
    )
    .then(checkResponses => {
      const checkEvents = checkResponses.filter(
        (checkResponse): checkResponse is CheckEvent => checkResponse != null
      )
      const serverRepoTimestamps = checkEvents.map(
        checkEvent => checkEvent.serverRepoTimestamp
      )

      checkEvents.forEach(checkEvent => {
        send(checkEvent)
      })

      repoUpdateIsSynced(serverRepoTimestamps, config)
    })
    .then(() => {
      if (
        config.maxUpdatesPerRepo === 0 ||
        updatesDone < config.maxUpdatesPerRepo ||
        !isRepoSynced
      ) {
        return checker(config, syncClients, readLock)
      }
    })

interface CheckServerStatusProps {
  sync: SyncClient
  repoId: string
}

async function checkServerStatus({
  sync,
  repoId
}: CheckServerStatusProps): Promise<CheckEvent | undefined> {
  const requestTime = Date.now()

  try {
    const response = await sync.getUpdates(repoId)

    const serverRepoTimestamp: TimestampRev = response.data.timestamp

    return {
      type: 'check',
      serverHost: sync.host,
      repoId,
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
        repoId,
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
