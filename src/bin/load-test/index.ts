import { ChildProcess } from 'child_process'
import { makeConfig } from 'cleaner-config'
import minimist from 'minimist'
import { join } from 'path'
import pino from 'pino'

import { AllEvents, asAllEvents } from '../types/shared-events'
import {
  endInstrument,
  makeInstrument,
  startInstrument
} from '../utils/instrument'
import { addToMetric, makeMetric } from '../utils/metric'
import { prettyPrintObject } from '../utils/printing'
import { makeSyncKey } from '../utils/utils'
import { makeWorkerCluster } from '../utils/worker-cluster'
import { asConfig, Config, configSample } from './config'
import { WorkerConfig } from './worker'

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info'
})

// Types

interface State {
  startTime: number
  syncKeys: string[]
}

// State:

let config: Config

// Metrics
const bytesMetric = makeMetric()
const updateTimeMetric = makeMetric()
const readTimeMetric = makeMetric()

// Instruments
const updateTimeInstrument = makeInstrument()
const readTimeInstrument = makeInstrument()

// Initialize state
const state: State = {
  startTime: Date.now(),
  syncKeys: []
}

async function main(): Promise<void> {
  logger.info({ msg: 'starting load test', config })

  // Generate an array of unique repo IDs of configured repoCount length
  const syncKeys = generateSyncKeys(config.syncKeyPrefix, config.repoCount)

  logger.debug({ msg: 'syncKeys generated', syncKeys })

  // Worker Cluster Process
  // ---------------------------------------------------------------------
  // spawn
  const workerCluster = makeWorkerCluster(
    join(__dirname, 'worker'),
    payload => {
      try {
        onEvent(asAllEvents(payload))
      } catch (err) {
        logger.error({ msg: 'worker cluster output error', err, payload })
        exit('worker exception')
      }
    },
    err => exit('worker exception', err)
  )

  // Start Inital Worker Routines
  // ---------------------------------------------------------------------
  syncKeys.forEach(syncKey => startWorkerRoutine(workerCluster, syncKey))

  const intervalIds: NodeJS.Timeout[] = []

  // Increase repo count every minute
  function repoCountIncreaser(): void {
    const numOfActiveRepos = state.syncKeys.length
    const numOfActiveReposUpdated = Math.min(
      numOfActiveRepos * config.repoCountIncreaseRatePerMin,
      config.maxRepoCount
    )
    const numOfNewRepos = Math.round(numOfActiveReposUpdated - numOfActiveRepos)

    if (numOfActiveRepos + numOfNewRepos > config.maxRepoCount) {
      return
    }

    logger.debug({ msg: 'repo-increase', numOfNewRepos })

    for (let i = 0; i < numOfNewRepos; ++i) {
      const newSyncKey = makeSyncKey(
        state.syncKeys.length,
        config.syncKeyPrefix
      )
      startWorkerRoutine(workerCluster, newSyncKey)
      logger.debug({ msg: 'new-repo', newSyncKey })
    }
  }
  intervalIds.push(setInterval(repoCountIncreaser, 60000))

  // Log a status every 30 seconds
  function logStatus(): void {
    logger.info({ msg: 'status', ...getStatus() })
  }
  intervalIds.push(setInterval(logStatus, 30000))

  // Console updater
  function consoleUpdater(): void {
    const status = getStatus()
    logger.trace({
      msg: 'console',
      status: [
        prettyPrintObject({
          'Repo count': status.repos.count
        }),
        prettyPrintObject({
          'Total updates': `${status.updates.total}`,
          'Avg repo update time': `${status.updates.avgEvery}`,
          'Avg repo update per min': `${status.updates.avgPerMin}`
        }),
        prettyPrintObject({
          'Total reads': `${status.reads.total}`,
          'Avg repo read time': `${status.reads.avgEvery}`,
          'Avg repo read per min': `${status.reads.avgPerMin}`
        }),
        prettyPrintObject({
          'Total bytes sent': `${status.payload.total}`,
          'Avg bytes sent': `${status.payload.avg}`,
          'Max bytes sent': `${status.payload.max}`,
          'Min bytes sent': `${status.payload.min}`
        }),
        prettyPrintObject({
          'Time Elapsed': status.timeElapsed
        })
      ]
    })
  }
  intervalIds.push(setInterval(consoleUpdater, 100))

  // Exit conditions
  function exitConditionChecker(): void {
    if (config.maxTimeElapse !== 0 && getTimeElapsed() > config.maxTimeElapse) {
      exitGracefully('exceeded max time elapsed')
    }
  }
  intervalIds.push(setInterval(exitConditionChecker, 100))

  // Exits process by killing workers and stopping intervalIds before exiting
  function exitGracefully(reason: string): void {
    // Exit all worker processes
    workerCluster.kill('SIGTERM')

    // Stop all intervals
    intervalIds.forEach(intervalId => clearInterval(intervalId))

    // exit process
    exit(reason)
  }
}

function startWorkerRoutine(
  workerCluster: ChildProcess,
  syncKey: string
): void {
  const workerConfig: WorkerConfig = {
    clusters: config.clusters,
    syncKey,
    config
  }
  workerCluster.send(workerConfig)
  state.syncKeys.push(syncKey)
}

function onEvent(event: AllEvents): void {
  const { type: msg, ...rest } = event
  logger.debug({ msg, ...rest })

  switch (event.type) {
    case 'error':
      logger.warn({ err: event.err, process: event.process })
      break
    case 'message':
      logger.info({ msg: 'message', event })
      break
    case 'ready': {
      if (updateTimeInstrument.start === null) {
        startInstrument(updateTimeInstrument, Date.now())
      }
      if (readTimeInstrument.start === null) {
        startInstrument(readTimeInstrument, Date.now())
      }
      break
    }
    case 'update': {
      const repoUpdateTime = endInstrument(updateTimeInstrument, Date.now())
      addToMetric(updateTimeMetric, repoUpdateTime)
      addToMetric(bytesMetric, event.payloadSize)
      startInstrument(updateTimeInstrument, Date.now())
      break
    }
    case 'read': {
      const repoReadTime = endInstrument(readTimeInstrument, Date.now())
      addToMetric(readTimeMetric, repoReadTime)
      startInstrument(readTimeInstrument, Date.now())
      break
    }
  }
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function getStatus() {
  const convertMsToPerMin = (ms: number): number => (ms !== 0 ? 60000 / ms : 0)

  return {
    repos: {
      count: state.syncKeys.length
    },
    payload: {
      total: bytesMetric.sum,
      avg: bytesMetric.avg,
      min: bytesMetric.min,
      max: bytesMetric.max
    },
    updates: {
      total: updateTimeMetric.total,
      avgPerMin: convertMsToPerMin(updateTimeMetric.avg),
      avgEvery: `${updateTimeMetric.avg}ms`,
      maxEvery: `${updateTimeMetric.max}ms`
    },
    reads: {
      total: readTimeMetric.total,
      avgPerMin: convertMsToPerMin(readTimeMetric.avg),
      avgEvery: `${readTimeMetric.avg}ms`,
      maxEvery: `${readTimeMetric.max}ms`
    },
    timeElapsed: `${getTimeElapsed()}ms`
  }
}

function getTimeElapsed(): number {
  return Date.now() - state.startTime
}

function generateSyncKeys(syncKeyPrefix: string, count: number): string[] {
  const arr = []
  for (let i = 0; i < count; ++i) {
    arr.push(makeSyncKey(i, syncKeyPrefix))
  }
  return arr
}

// Startup

try {
  const argv = minimist(process.argv.slice(2))
  const jsonArg = argv._[0]
  const configJson: string | undefined = jsonArg
  const configFile = process.env.CONFIG ?? 'config.test.load.json'

  try {
    if (configJson == null) {
      config = makeConfig(asConfig, configFile)
    } else {
      config = asConfig(JSON.parse(configJson))
    }

    main().catch(errHandler)
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : JSON.stringify(err)

    errHandler(
      [
        `Config error: ${errMessage}`,
        ``,
        `Usage:`,
        `  yarn test.load`,
        `  CONFIG=config.custom.json yarn test.load`,
        `  yarn test.load $json`,
        ``,
        `Example JSON Config:`,
        JSON.stringify(configSample, null, 2)
      ].join('\n')
    )
  }
} catch (error) {
  if (error instanceof TypeError) {
    errHandler(`Invalid config: ${error.message}`)
  }
  throw error
}

process.on('unhandledRejection', error => {
  console.warn(`UNHANDLED PROMISE!!!`)
  if (error instanceof Error) errHandler(error)
})

function errHandler(err: Error | string): void {
  // Handle error strings as CLI error message
  if (typeof err === 'string') {
    console.error(err)
    process.exit(1)
  }

  exit('exception', err)
}

function exit(reason: string, error?: Error): void {
  // Final output status
  logger.info({ msg: 'status', ...getStatus() })

  // Log error if passed
  if (error != null) {
    logger.error(error)
  }

  // Log reason for exiting
  logger.info({ msg: 'finished load tests', reason })

  process.exit(error == null ? 0 : 1)
}
