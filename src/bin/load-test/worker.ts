import { asArray, asMap, asObject, asString } from 'cleaners'
import { randomInt } from 'crypto'

import { ReadEvent, ReadyEvent, UpdateEvent } from '../types/shared-events'
import { SyncClient } from '../utils/SyncClient'
import { delay, send } from '../utils/utils'
import { startWorkerCluster } from '../utils/worker-cluster'
import { asConfig } from './config'

// Settings
export type WorkerConfig = ReturnType<typeof asWorkerConfig>
export const asWorkerConfig = asObject({
  clusters: asMap(asArray(asString)),
  syncKey: asString,
  config: asConfig
})

// Main Function
export async function workerRoutine(settings: WorkerConfig): Promise<void> {
  // Create sync client
  const serverUrls = Object.values(settings.clusters).reduce<string[]>(
    (serverUrls, urls) => {
      return [...serverUrls, ...urls]
    },
    []
  )
  const syncClient = new SyncClient(serverUrls)

  // Create repos
  send(await initializeRepo(syncClient, settings.syncKey))

  // Run updater
  updater(settings, syncClient).catch(errHandler)

  // Run reader
  reader(settings, syncClient).catch(errHandler)
}

// Start worker cluster
startWorkerCluster(workerRoutine, asWorkerConfig)

// Creates repo if it does not exist.
const initializeRepo = async (
  sync: SyncClient,
  syncKey: string
): Promise<ReadyEvent> => {
  try {
    await sync.createRepo(syncKey)
    const requestTime = Date.now()
    const serverRepoHash: string = ''

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
      const serverRepoHash = response.hash

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
  settings: WorkerConfig,
  syncClient: SyncClient
): Promise<void> => {
  return updateRepo(settings, syncClient)
    .then(send)
    .catch(err => {
      send(err)
    })
    .then(() => {
      return delay((60 / settings.config.repoUpdatesPerMin) * 1000).then(() =>
        updater(settings, syncClient)
      )
    })
}

async function updateRepo(
  settings: WorkerConfig,
  syncClient: SyncClient
): Promise<UpdateEvent> {
  const serverHost = syncClient.lastUsedHost()
  const syncKey = settings.syncKey
  const fileCount = randomInt(
    settings.config.fileCountRange[0],
    settings.config.fileCountRange[1] + 1
  )
  const changeSet = await syncClient.randomChangeSet(
    syncKey,
    fileCount,
    settings.config.fileByteSizeRange
  )
  const payloadSize = Buffer.byteLength(JSON.stringify(changeSet))

  // Write update
  const response = await syncClient.updateFiles(syncKey, changeSet)
  const serverRepoHash = response.hash
  const requestTime = Date.now()

  return {
    type: 'update',
    serverHost,
    syncKey,
    requestTime,
    serverRepoHash,
    payloadSize
  }
}

const reader = (
  settings: WorkerConfig,
  syncClient: SyncClient
): Promise<void> => {
  return readRepo(settings, syncClient)
    .then(send)
    .catch(err => {
      send(err)
    })
    .then(() => {
      return delay((60 / settings.config.repoReadsPerMin) * 1000).then(() =>
        reader(settings, syncClient)
      )
    })
}

async function readRepo(
  settings: WorkerConfig,
  syncClient: SyncClient
): Promise<ReadEvent> {
  const serverHost = syncClient.lastUsedHost()
  const syncKey = settings.syncKey

  // Read repo
  const response = await syncClient.getUpdates(syncKey)
  const serverRepoHash = response.hash
  const requestTime = Date.now()

  // Send a check event just because we can.
  // We might as well use the response to help with metrics.
  return {
    type: 'read',
    serverHost,
    syncKey,
    requestTime,
    serverRepoHash
  }
}

function errHandler(err: Error): void {
  send(err)
  process.exit(1)
}
