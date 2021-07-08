import { asMaybe } from 'cleaners'
import cluster from 'cluster'
import os from 'os'

import { asWorkerConfig } from './types'
import { send } from './utils/utils'
import { workerRoutine } from './worker-routine'

process.title = 'worker-cluster'

// Main
async function main(): Promise<void> {
  if (cluster.isMaster) {
    const cpuCount = os.cpus().length
    const workerPool: cluster.Worker[] = []

    for (let i = 0; i < cpuCount; ++i) {
      const worker = cluster.fork()

      worker.on('message', payload => {
        send(payload)
      })

      worker.on('exit', (code): void => {
        if (code !== null && code !== 0) {
          errHandler(new Error(`Worker child exited with code ${String(code)}`))
        }
      })

      workerPool.push(worker)
    }

    // Listen for events from the supervising process and delegate it to one
    // of the workers to create a worker routine in round-robin fashion.
    process.on('message', payload => {
      const workerConfig = asMaybe(asWorkerConfig)(payload)

      if (workerConfig == null) {
        throw new Error(
          `Invalid worker config from message event: ${JSON.stringify(payload)}`
        )
      }

      // Take worker from pool
      const worker = workerPool.shift()

      if (worker == null) {
        throw new Error(`Unexpected error: could not take a worker from pool`)
      }

      // Send worker config (delegate)
      worker.send(workerConfig)

      // Push worker back into pool (at the end)
      workerPool.push(worker)
    })
  } else {
    // Listen for message events and respond by creating a worker routine
    process.on('message', payload => {
      const workerConfig = asWorkerConfig(payload)

      workerRoutine(workerConfig).catch(errHandler)
    })
  }
}

// Startup:

main().catch(errHandler)

process.on('unhandledRejection', error => {
  send(`UNHANDLED PROMISE!!!`)
  if (error instanceof Error) errHandler(error)
})

function errHandler(err: Error): void {
  send(err)
  process.exit(1)
}
