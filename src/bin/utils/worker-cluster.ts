import { ChildProcess, fork, Serializable } from 'child_process'
import { asMaybe, Cleaner } from 'cleaners'
import cluster from 'cluster'
import os from 'os'

import { send } from './utils'

export function makeWorkerCluster(
  workerFile: string,
  onEvent: (payload: Serializable) => void,
  onError: (err: Error) => void = () => {}
): ChildProcess {
  const workerCluster = fork(workerFile)
  // events
  workerCluster.on('message', payload => {
    onEvent(payload)
  })
  workerCluster.on('exit', (code): void => {
    if (code !== null && code !== 0) {
      onError(new Error(`Worker master exited with code ${String(code)}`))
    }
  })

  return workerCluster
}

export function startWorkerCluster<T extends Serializable>(
  workerRoutine: (settings: T) => Promise<void>,
  asWorkerSettings: Cleaner<T>
): void {
  if (cluster.isMaster) {
    process.title = 'worker-cluster'

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
      const workerSettings = asMaybe(asWorkerSettings)(payload)

      if (workerSettings == null) {
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
      worker.send(workerSettings)

      // Push worker back into pool (at the end)
      workerPool.push(worker)
    })
  } else {
    process.title = 'worker-cluster'

    // Listen for message events and respond by creating a worker routine
    process.on('message', payload => {
      const workerSettings = asWorkerSettings(payload)

      workerRoutine(workerSettings).catch(errHandler)
    })
  }
}

function errHandler(err: Error): void {
  send(err)
  process.exit(1)
}
