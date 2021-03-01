import { randomInt } from 'crypto'
import { cpus } from 'os'
import Semaphore from 'semaphore-async-await'

import { TimestampRev } from '../../types'
import { SyncClient } from './SyncClient'
import { asWorkerInput, ReadyEvent, UpdateEvent, WorkerInput } from './types'
import { isAcceptableError, randomElement, send, throttle } from './utils/utils'

process.title = 'worker'

let opsQueued = 0
let opsDone = 0

// Main
async function main(input: WorkerInput): Promise<void> {
  const concurrency = Math.min(cpus().length, input.maxOpCount)

  send(`Concurrency: ${concurrency}`)

  const lock = new Semaphore(concurrency)
  lock.drainPermits()

  const getOpDelay = (): number => 1000 / input.maxOpsPerSecond
  const releaser = (): void => {
    if (opsDone < input.maxOpCount) {
      lock.release()
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
  await Promise.all(
    input.repoIds.map(async repoId => {
      const sync = randomElement(syncClients)

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
    })
  )

  // Run workers
  for (let i = 0; i < concurrency; ++i) {
    ++opsQueued
    workRoutine(input, syncClients, lock).catch(errHandler)
  }
}

const workRoutine = (
  input: WorkerInput,
  syncClients: SyncClient[],
  lock: Semaphore
): Promise<void> => {
  return work(input, syncClients, lock)
    .then(send)
    .then(() => {
      if (opsQueued < input.maxOpCount) {
        ++opsQueued
        return workRoutine(input, syncClients, lock)
      }
    })
}

async function work(
  input: WorkerInput,
  syncClients: SyncClient[],
  lock: Semaphore
): Promise<UpdateEvent> {
  await lock.acquire()

  const sync = randomElement(syncClients)

  const serverHost = sync.host
  const repoId = randomElement(input.repoIds)

  const fileCount = randomInt(input.fileCountRange[0], input.fileCountRange[1])
  const files = await sync.randomFilePayload(fileCount)
  const payloadSize = Buffer.byteLength(JSON.stringify(files))

  try {
    // Make sure the worker is up-to-date with the repo in order to successfully
    // write update.
    await sync.getUpdates(repoId)

    // Write update
    const response = await sync.updateFiles(repoId, files)

    const serverRepoTimestamp = response.data.timestamp
    const requestTime = Date.now()

    ++opsDone

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
    return await throttle(() => work(input, syncClients, lock), 500)
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
