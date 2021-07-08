import { asArray, asMap, asNumber, asObject, asString } from 'cleaners'
import { randomInt } from 'crypto'

import { ReadEvent, ReadyEvent, UpdateEvent } from '../types/shared-events'
import { SyncClient } from '../utils/SyncClient'
import {
  delay,
  isErrorWorthRetry,
  isRepoNotFoundError,
  randomElement,
  send,
  throttle
} from '../utils/utils'
import { startWorkerCluster } from '../utils/worker-cluster'

// State
let updatesDone = 0
let lastUpdateHash = ''
let isRepoSynced: boolean = true

export type WorkerConfig = ReturnType<typeof asWorkerConfig>
export const asWorkerConfig = asObject({
  clusters: asMap(asArray(asString)),
  syncKey: asString,
  repoUpdatesPerMin: asNumber,
  repoReadsPerMin: asNumber,
  repoCheckDelayInSeconds: asNumber,
  repoUpdateIncreaseRate: asNumber,
  maxUpdatesPerRepo: asNumber,
  fileByteSizeRange: asArray(asNumber),
  fileCountRange: asArray(asNumber)
})

// Main Function
export async function workerRoutine(config: WorkerConfig): Promise<void> {
  // Create sync clients
  const syncClients = Object.values(config.clusters).reduce<SyncClient[]>(
    (syncClients, urls) => {
      const clients = urls.map(serverUrl => new SyncClient([serverUrl]))
      return [...syncClients, ...clients]
    },
    []
  )

  // Create repos
  send(await getRepoReady(randomElement(syncClients), config.syncKey))

  // Run updater
  updater(config, syncClients).catch(errHandler)

  // Run reader
  reader(config, syncClients).catch(errHandler)

  // Run the checker
  checker(config, syncClients).catch(errHandler)
}

// Start worker cluster
startWorkerCluster(workerRoutine, asWorkerConfig)

// Creates repo if it does not exist.
const getRepoReady = async (
  sync: SyncClient,
  syncKey: string
): Promise<ReadyEvent> => {
  try {
    await sync.createRepo(syncKey)
    const requestTime = Date.now()
    const serverRepoHash: string = ''

    lastUpdateHash = serverRepoHash

    return {
      type: 'ready',
      serverHost: sync.lastUsedHost(),
      syncKey,
      requestTime,
      serverRepoHash
    }
  } catch (error) {
    if (error?.response?.message === 'Datastore already exists') {
      const response = await sync.getUpdates(syncKey)
      const requestTime = Date.now()
      const serverRepoHash: string = response.hash

      return {
        type: 'ready',
        serverHost: sync.lastUsedHost(),
        syncKey,
        requestTime,
        serverRepoHash
      }
    }

    throw error
  }
}

const updater = (
  config: WorkerConfig,
  syncClients: SyncClient[]
): Promise<void> => {
  return updateRepo(config, syncClients)
    .then(send)
    .catch(err => {
      send(err)
    })
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
    const serverHost = sync.lastUsedHost()
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
    if (!isErrorWorthRetry(error)) {
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
    .catch(err => {
      send(err)
    })
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
): Promise<ReadEvent> {
  const sync = randomElement(syncClients)
  const syncKey = config.syncKey

  try {
    // Read repo
    const response = await sync.getUpdates(syncKey)
    const serverHost = sync.lastUsedHost()
    const serverRepoHash = response.hash
    const requestTime = Date.now()

    lastUpdateHash = serverRepoHash

    // Send a check event just because we can.
    // We might as well use the response to help with metrics.
    return {
      type: 'read',
      serverHost,
      syncKey,
      requestTime,
      serverRepoHash
    }
  } catch (error) {
    if (!isErrorWorthRetry(error)) {
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
    .then(readResponses => {
      const readEvents = readResponses.filter(
        (readResponse): readResponse is ReadEvent => readResponse != null
      )
      readEvents.forEach(readEvent => {
        send(readEvent)
      })

      const serverRepoHashes = readEvents.map(
        readEvent => readEvent.serverRepoHash
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
    .catch(err => {
      send(err)
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
}: CheckServerStatusProps): Promise<ReadEvent | undefined> {
  const requestTime = Date.now()

  try {
    const response = await sync.getUpdates(syncKey)

    const serverRepoHash: string = response.hash

    return {
      type: 'read',
      serverHost: sync.lastUsedHost(),
      syncKey,
      requestTime,
      serverRepoHash
    }
  } catch (error) {
    if (!isErrorWorthRetry(error)) {
      throw error
    }

    if (isRepoNotFoundError(error)) {
      return {
        type: 'read',
        serverHost: sync.lastUsedHost(),
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

function errHandler(err: Error): void {
  send(err)
  process.exit(1)
}
