import { randomInt } from 'crypto'
import Semaphore from 'semaphore-async-await'

import { asTimestampRev, TimestampRev } from '../../types'
import { SyncClient } from './SyncClient'
import {
  asWorkerInput,
  CheckEvent,
  ReadyEvent,
  UpdateEvent,
  WorkerInput
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
  input: WorkerInput
): void => {
  const isSynced = serverRepoTimestamps.every(
    serverRepoTimestamp => serverRepoTimestamp === lastUpdateTimestamp
  )

  // If repo is has synced across all servers, then increase update rate
  if (!isRepoSynced && isSynced) {
    input.repoUpdatesPerMin =
      input.repoUpdatesPerMin * input.repoUpdateIncreaseRate
  }

  // Update state
  isRepoSynced = isSynced
}

// Main
async function main(input: WorkerInput): Promise<void> {
  const updateLock = new Semaphore(1)
  const readLock = new Semaphore(1)

  const getUpdateDelay = (): number => (60 / input.repoUpdatesPerMin) * 1000
  const updateLockReleaser = (): void => {
    updateLock.release()

    if (
      input.maxUpdatesPerRepo === 0 ||
      updatesDone + 1 < input.maxUpdatesPerRepo
    ) {
      setTimeout(updateLockReleaser, getUpdateDelay())
    }
  }
  const getReadLockDelay = (): number => (60 / input.repoReadsPerMin) * 1000
  const readLockReleaser = (): void => {
    readLock.release()

    if (
      input.maxUpdatesPerRepo === 0 ||
      updatesDone + 1 < input.maxUpdatesPerRepo
    ) {
      setTimeout(readLockReleaser, getReadLockDelay())
    }
  }
  // Initialize lock releasers
  updateLock.drainPermits()
  updateLockReleaser()
  readLock.drainPermits()
  readLockReleaser()

  process.on('message', message => {
    try {
      input = asWorkerInput(message)
    } catch (error) {
      throw new Error(`Invalid input from message event`)
    }
  })

  // Create sync clients
  const syncClients = Object.entries(input.clusters).reduce<SyncClient[]>(
    (syncClients, [clusterName, urls]) => {
      const clients = urls.map(
        serverUrl => new SyncClient(serverUrl, clusterName)
      )
      return [...syncClients, ...clients]
    },
    []
  )

  // Create repos
  await getRepoReady(randomElement(syncClients), input.repoId)

  // Run updater
  updater(input, syncClients, updateLock, readLock).catch(errHandler)

  // Run the checker
  checker(input, syncClients, readLock).catch(errHandler)
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
  input: WorkerInput,
  syncClients: SyncClient[],
  updateLock: Semaphore,
  readLock: Semaphore
): Promise<void> => {
  return updateRepo(input, syncClients, updateLock)
    .then(send)
    .then(() => {
      readLock.release()
      if (
        input.maxUpdatesPerRepo === 0 ||
        updatesQueued < input.maxUpdatesPerRepo
      ) {
        ++updatesQueued
        return updater(input, syncClients, updateLock, readLock)
      }
    })
}

async function updateRepo(
  input: WorkerInput,
  syncClients: SyncClient[],
  updateLock: Semaphore
): Promise<UpdateEvent> {
  await updateLock.acquire()

  const sync = randomElement(syncClients)

  const serverHost = sync.host
  const repoId = input.repoId

  const fileCount = randomInt(input.fileCountRange[0], input.fileCountRange[1])
  const changeSet = await sync.randomChangeSet(
    repoId,
    fileCount,
    input.fileByteSizeRange
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
    return await throttle(() => updateRepo(input, syncClients, updateLock), 500)
  }
}

const checker = (
  input: WorkerInput,
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
              syncClient.repoTimestamps[input.repoId] !== lastUpdateTimestamp
          )
          .map(sync => checkServerStatus({ sync, repoId: input.repoId }))
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

      repoUpdateIsSynced(serverRepoTimestamps, input)
    })
    .then(() => {
      if (
        input.maxUpdatesPerRepo === 0 ||
        updatesDone < input.maxUpdatesPerRepo ||
        !isRepoSynced
      ) {
        return checker(input, syncClients, readLock)
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

try {
  const jsonArg = process.argv[2]

  if (jsonArg == null) {
    throw new Error('Missing json argument.')
  }

  let input: WorkerInput

  try {
    input = asWorkerInput(JSON.parse(jsonArg))
  } catch (error) {
    if (error instanceof Error)
      throw new Error(`Invalid JSON input argument: ${error.message}`)
    throw error
  }

  main(input).catch(errHandler)
} catch (error) {
  if (error instanceof TypeError) {
    send(new Error(`Invalid JSON input argument: ${error.message}`))
  } else {
    send(error)
  }
}

process.on('unhandledRejection', error => {
  send(`UNHANDLED PROMISE!!!`)
  if (error instanceof Error) errHandler(error)
})

function errHandler(err: Error): void {
  send(err)
  process.exit(1)
}
