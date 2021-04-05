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
  delay,
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
const updateIsRepoSynced = (
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
  const lock = new Semaphore(1)
  lock.drainPermits()

  const getOpDelay = (): number => 1000 / (input.repoUpdatesPerMin / 60)
  const releaser = (): void => {
    lock.release()

    if (
      input.maxUpdatesPerRepo === 0 ||
      updatesDone + 1 < input.maxUpdatesPerRepo
    ) {
      setTimeout(releaser, getOpDelay())
    }
  }
  // Start releaser
  releaser()

  process.on('message', message => {
    try {
      input = asWorkerInput(message)
    } catch (error) {
      throw new Error(`Invalid input from message event`)
    }
  })

  // Create sync clients
  const syncClients = input.serverUrls.map(
    serverUrl => new SyncClient(serverUrl)
  )

  // Create repos
  await getRepoReady(randomElement(syncClients), input.repoId)

  // Run updater
  updater(input, syncClients, lock).catch(errHandler)

  // Run the checker
  checker(input, syncClients).catch(errHandler)
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
  lock: Semaphore
): Promise<void> => {
  return updateRepo(input, syncClients, lock)
    .then(send)
    .then(() => {
      if (
        input.maxUpdatesPerRepo === 0 ||
        updatesQueued < input.maxUpdatesPerRepo
      ) {
        ++updatesQueued
        return updater(input, syncClients, lock)
      }
    })
}

async function updateRepo(
  input: WorkerInput,
  syncClients: SyncClient[],
  lock: Semaphore
): Promise<UpdateEvent> {
  await lock.acquire()

  const sync = randomElement(syncClients)

  const serverHost = sync.host
  const repoId = input.repoId

  const fileCount = randomInt(input.fileCountRange[0], input.fileCountRange[1])
  const changeSet = await sync.randomChangeSet(
    repoId,
    fileCount,
    input.fileSizeRange
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
    lock.release()
    return await throttle(() => updateRepo(input, syncClients, lock), 500)
  }
}

const checker = (
  input: WorkerInput,
  syncClients: SyncClient[]
): Promise<void> =>
  Promise.all(
    syncClients.map(sync => checkServerStatus({ sync, repoId: input.repoId }))
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

      updateIsRepoSynced(serverRepoTimestamps, input)
    })
    .then(() => delay(500))
    .then(() => {
      if (
        input.maxUpdatesPerRepo === 0 ||
        updatesDone < input.maxUpdatesPerRepo ||
        !isRepoSynced
      ) {
        return checker(input, syncClients)
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
