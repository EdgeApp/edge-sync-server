import { eq, gt, toFixed } from 'biggystring'
import { fork } from 'child_process'
import { readFileSync } from 'fs'
import minimist from 'minimist'
import { join } from 'path'

import { TimestampRev } from '../../types'
import { asConfig, Config, configSample } from './config'
import {
  AllEvents,
  asAllEvents,
  CheckEvent,
  NetworkSyncEvent,
  ReadyEvent,
  RepoSyncEvent,
  ServerSyncEvent,
  UpdateEvent,
  WorkerInput
} from './types'
import {
  endInstrument,
  Instrument,
  makeInstrument,
  measureInstrument,
  startInstrument
} from './utils/instrument'
import { addToMetric, makeMetric } from './utils/metric'
import {
  prettyPrintObject,
  print,
  printLog,
  statusBarLine,
  statusBox
} from './utils/printing'
import { makeRepoId } from './utils/utils'

// Types

interface State {
  startTime: number
  repos: RepoStateMap
  serverSyncInfoMap: ServerSyncInfoMap
  output: Output | null
}

type RepoStateMap = Map<string, RepoState>
interface RepoState {
  serverHost: string
  updateRequestTime: number
  repoTimestamp: TimestampRev
  syncTimeInstrument: Instrument
}

interface ServerSyncInfoMap {
  [serverHost: string]: ServerSyncInfo
}
interface ServerSyncInfo {
  inSync: boolean
  repos: RepoSyncInfoMap
}
interface RepoSyncInfoMap {
  [repoId: string]: RepoSyncInfo
}
interface RepoSyncInfo {
  inSync: boolean
}

interface Output {
  reason: string
  totalBytesSent: number
  totalUpdateCount: number
  avgUpdatesPerSec: number
  avgUpdateTimeInMs: number
  maxUpdateTimeInMs: number
  totalRepoSyncCount: number
  avgRepoSyncPerSec: number
  avgRepoSyncTimeInMs: number
  maxRepoSyncTimeInMs: number
}

// State:

let config: Config
let serverCount: number = 0

// Metrics
const repoUpdateTimeMetric = makeMetric()
const bytesMetric = makeMetric()
const repoSyncMetric = makeMetric()
const serverSyncMetric = makeMetric()
const networkSyncMetric = makeMetric()

// Instruments
const opTimeInstrument = makeInstrument()
const serverSyncInstrument = makeInstrument()
const networkSyncInstrument = makeInstrument()

const state: State = {
  startTime: Date.now(),
  repos: new Map(),
  serverSyncInfoMap: {},
  output: null
}

async function main(): Promise<void> {
  console.log(`Verbosity: ${String(config.verbose)}`)

  const serverUrls = Object.values(config.clusters).reduce<string[]>(
    (allUrls, urls) => {
      return [...allUrls, ...urls]
    },
    []
  )
  serverCount = serverUrls.length

  console.log(`Generating random repos...`)
  // Generate an array of unique repo IDs of configured repoCount length
  const repoIds = generateRepoIds(config.repoPrefix, config.repoCount)

  // Generate Sync Server Info for each server and host
  state.serverSyncInfoMap = generateSyncInfoMap(serverUrls, repoIds)

  if (config.verbose) {
    console.log(`Repos:\n  ${repoIds.join('\n  ')}`)
    console.log(`Servers:\n  ${serverUrls.join('\n  ')}`)
  }

  // Worker Process
  // ---------------------------------------------------------------------
  console.info(`Forking worker processes (${repoIds.length})...`)
  const workerProcesses = repoIds.map(repoId => {
    const workerInput: WorkerInput = {
      clusters: config.clusters,
      repoId,
      repoUpdatesPerMin: config.repoUpdatesPerMin,
      repoReadsPerMin: config.repoReadsPerMin,
      repoUpdateIncreaseRate: config.repoUpdateIncreaseRate,
      maxUpdatesPerRepo: config.maxUpdatesPerRepo,
      fileByteSizeRange: config.fileByteSizeRange,
      fileCountRange: config.fileCountRange
    }
    const workerJsonInput = JSON.stringify(workerInput, null, 2)

    // spawn
    const workerPs = fork(join(__dirname, 'worker.ts'), [workerJsonInput])

    // events
    workerPs.on('message', payload => {
      try {
        const output = asAllEvents(payload)
        onEvent(output)
      } catch (error) {
        if (error instanceof TypeError) {
          console.log({ payload })
          throw new Error(`Invalid worker output: ${error.message}`)
        }
        throw error
      }
    })
    workerPs.on('exit', (code): void => {
      if (code !== null && code !== 0) {
        throw new Error(`Worker process exited with code ${String(code)}`)
      }
      print('! worker process finished')
    })

    return workerPs
  })

  function exit(reason: string): void {
    // Exit all worker processes
    workerProcesses.forEach(workerPs => workerPs.kill('SIGTERM'))

    // Stop the status updater interval
    clearInterval(statusUpdaterIntervalId)

    // Print reason for exiting
    print(`!!! ${reason}`)

    // Post-processing for output results

    const totalBytesSent = bytesMetric.sum
    const totalUpdateCount = repoUpdateTimeMetric.total
    const totalRepoSyncCount = repoSyncMetric.total

    state.output = {
      reason,
      totalBytesSent,
      totalUpdateCount,
      avgUpdatesPerSec:
        repoUpdateTimeMetric.avg !== 0 ? 1000 / repoUpdateTimeMetric.avg : 0,
      avgUpdateTimeInMs: repoUpdateTimeMetric.avg,
      maxUpdateTimeInMs: repoUpdateTimeMetric.max,
      totalRepoSyncCount,
      avgRepoSyncPerSec:
        repoSyncMetric.avg !== 0 ? 1000 / repoSyncMetric.avg : 0,
      avgRepoSyncTimeInMs: repoSyncMetric.avg,
      maxRepoSyncTimeInMs: repoSyncMetric.max
    }

    console.log(JSON.stringify(state.output, null, 2))
    process.exit()
  }

  function statusUpdater(): void {
    const timeSinceNetworkOutOfSync = measureInstrument(
      networkSyncInstrument,
      Date.now()
    )
    const totalRepoUpdates = repoUpdateTimeMetric.total
    const avgUpdatesPerSec =
      repoUpdateTimeMetric.avg !== 0 ? 1000 / repoUpdateTimeMetric.avg : 0
    const repoSyncTimes = Array.from(state.repos.entries()).map(
      ([repoId, repoState]) => {
        const syncTime = Date.now() - repoState.updateRequestTime

        return getIsRepoSynced(repoId) ? 0 : syncTime
      }
    )
    const maxRepoSyncTime = Math.max(...repoSyncTimes)

    const statusHeader = [
      [
        `${checkmarkify(getIsNetworkInSync(serverCount))} network in-sync`,
        `${timeSinceNetworkOutOfSync}ms since network sync `
      ].join(' | '),
      statusBarLine(),
      [
        `${countServersInSync()} / ${serverCount} servers in-sync`,
        ...Object.entries(state.serverSyncInfoMap).map(
          ([serverHost, { inSync }]) => `${checkmarkify(inSync)} ${serverHost}`
        )
      ].join(' | '),
      statusBarLine(),
      [
        `${countReposInSync()} / ${config.repoCount} repos in-sync`,
        `maximum ${maxRepoSyncTime}ms since repo out of sync`
      ].join(' | ')
    ]

    statusBox(
      [
        ...statusHeader,
        statusBarLine(),
        prettyPrintObject({
          'Total updates': `${totalRepoUpdates} / ${
            config.maxUpdatesPerRepo * config.repoCount
          }`,
          'Avg repo update time': `${repoUpdateTimeMetric.avg}ms`,
          'Avg repo update / sec': `${avgUpdatesPerSec}`,
          'Total bytes sent': `${bytesMetric.sum}`
        }),
        statusBarLine(),
        prettyPrintObject({
          'Total repo syncs': `${repoSyncMetric.total}`,
          'Avg repo sync time': `${repoSyncMetric.avg}ms`,
          'Max repo sync time': `${repoSyncMetric.max}ms`
        }),
        statusBarLine(),
        prettyPrintObject({
          'Total server syncs': `${serverSyncMetric.total}`,
          'Avg server sync time': `${serverSyncMetric.avg}ms`,
          'Max server sync time': `${serverSyncMetric.max}ms`
        }),
        statusBarLine(),
        prettyPrintObject({
          'Total network syncs': `${networkSyncMetric.total}`,
          'Avg network sync time': `${networkSyncMetric.avg}ms`,
          'Max network sync time': `${networkSyncMetric.max}ms`
        })
      ].join('\n')
    )

    // Exit cases
    if (
      config.maxUpdatesPerRepo > 0 &&
      totalRepoUpdates >= config.maxUpdatesPerRepo * config.repoCount &&
      getIsNetworkInSync(serverCount)
    ) {
      exit('completed max operations')
    }

    if (maxRepoSyncTime > config.repoSyncTimeout) {
      exit('exceeded sync timeout')
    }
  }
  const statusUpdaterIntervalId = setInterval(statusUpdater, 100)

  function onEvent(event: AllEvents): void {
    switch (event.type) {
      case 'error':
        printLog('error', event.process, event.message)
        if (config.verbose)
          print({
            stack: event.stack,
            request: JSON.stringify(event.request, null, 2),
            response: JSON.stringify(event.response, null, 2)
          })
        break
      case 'message':
        printLog('message', event.process, event.message)
        break
      case 'ready':
        onReadyEvent(event)
        break
      case 'update':
        onUpdateEvent(event)
        break
      case 'check':
        onCheckEvent(event, onEvent)
        break
      case 'repo-sync':
        onRepoSync(event)
        break
      case 'server-sync':
        onServerSync(event)
        break
      case 'network-sync':
        onNetworkSync(event)
        break
    }
  }
}

function onReadyEvent(readyEvent: ReadyEvent): void {
  const { requestTime, serverHost, repoId, serverRepoTimestamp } = readyEvent

  state.repos.set(repoId, {
    serverHost,
    updateRequestTime: requestTime,
    repoTimestamp: serverRepoTimestamp,
    syncTimeInstrument: makeInstrument()
  })

  printLog('ready', serverHost, repoId, requestTime)
}

function onUpdateEvent(updateEvent: UpdateEvent): void {
  const opTime = endInstrument(opTimeInstrument, Date.now())
  startInstrument(opTimeInstrument, Date.now())

  addToMetric(repoUpdateTimeMetric, opTime)
  addToMetric(bytesMetric, updateEvent.payloadSize)

  const {
    requestTime,
    serverHost,
    repoId,
    serverRepoTimestamp,
    payloadSize
  } = updateEvent

  const repoState = state.repos.get(repoId)

  if (repoState == null) {
    throw new Error('Missing repo state')
  }

  if (gt(serverRepoTimestamp, repoState.repoTimestamp)) {
    state.repos.set(repoId, {
      ...repoState,
      updateRequestTime: requestTime,
      repoTimestamp: serverRepoTimestamp,
      serverHost
    })
  }

  printLog(
    'write',
    requestTime,
    serverHost,
    repoId,
    serverRepoTimestamp,
    payloadSize != null ? `${payloadSize} bytes` : ''
  )
}

function onCheckEvent(
  checkEvent: CheckEvent,
  onEvent: (output: AllEvents) => void
): void {
  const { serverHost, repoId } = checkEvent
  const repoState = state.repos.get(repoId)

  if (repoState == null) {
    printLog('checker', 'repo not ready', repoId)
    return
  }

  const status = eq(checkEvent.serverRepoTimestamp, repoState.repoTimestamp)
    ? 'replicated'
    : gt(checkEvent.serverRepoTimestamp, repoState.repoTimestamp)
    ? gt(toFixed(checkEvent.serverRepoTimestamp, 0, 0), repoState.repoTimestamp)
      ? 'ahead'
      : 'conflicting'
    : 'behind'

  const wasRepoInSync = getIsRepoInSyncWithServer(serverHost, repoId)
  const wasServerInSync = getIsServerInSync(serverHost)
  const wasNetworkInSync = getIsNetworkInSync(serverCount)

  if (status === 'replicated' && !wasRepoInSync) {
    onEvent({
      type: 'repo-sync',
      timestamp: checkEvent.requestTime,
      serverHost,
      repoId
    })

    const isServerInSync = getIsServerInSync(serverHost)
    const isNetworkInSync = getIsNetworkInSync(serverCount)

    // If server is now in-sync, emit a server-sync event
    if (!wasServerInSync && isServerInSync) {
      onEvent({
        type: 'server-sync',
        timestamp: checkEvent.requestTime,
        serverHost
      })
    }
    // If network is now in-sync, emit a network-sync event
    if (!wasNetworkInSync && isNetworkInSync) {
      onEvent({
        type: 'network-sync',
        timestamp: checkEvent.requestTime
      })
    }
  } else if (status === 'behind' && wasRepoInSync) {
    // If server is in-sync, then track server out-of-sync time
    if (wasServerInSync) {
      startInstrument(serverSyncInstrument, checkEvent.requestTime)
    }

    // If network is in-sync, then track network out-of-sync time
    if (wasNetworkInSync) {
      startInstrument(networkSyncInstrument, checkEvent.requestTime)
    }

    setIsRepoInSync(serverHost, repoId, false)

    printLog('desync', serverHost, repoId, checkEvent.requestTime)
  } else if (['ahead', 'conflicting'].includes(status)) {
    printLog(status, serverHost, repoId, checkEvent.requestTime)
  }
}

function onRepoSync(repoSyncEvent: RepoSyncEvent): void {
  const { timestamp, serverHost, repoId } = repoSyncEvent
  const repoState = state.repos.get(repoId)

  if (repoState == null) {
    printLog('worker', 'repo not ready', repoId)
    return
  }

  const repoSyncTime = timestamp - repoState.updateRequestTime

  addToMetric(repoSyncMetric, repoSyncTime)
  setIsRepoInSync(serverHost, repoId, true)

  printLog('sync', serverHost, repoId, timestamp, `${repoSyncTime}ms`)
}

function onServerSync(serverSyncEvent: ServerSyncEvent): void {
  const { timestamp, serverHost } = serverSyncEvent
  const serverSyncTime = endInstrument(serverSyncInstrument, timestamp)
  addToMetric(serverSyncMetric, serverSyncTime)

  printLog('server-sync', serverHost, timestamp, `${serverSyncTime}ms`)
}

function onNetworkSync(networkSyncEvent: NetworkSyncEvent): void {
  const { timestamp } = networkSyncEvent
  const networkSyncTime = endInstrument(networkSyncInstrument, timestamp)

  addToMetric(networkSyncMetric, networkSyncTime)

  printLog('net-sync', timestamp, `${networkSyncTime}ms`)
}

function setIsRepoInSync(
  serverHost: string,
  repoId: string,
  inSync: boolean
): void {
  const serverSyncInfo = state.serverSyncInfoMap[serverHost]
  const repoSyncInfo = serverSyncInfo.repos[repoId]
  repoSyncInfo.inSync = inSync
  setIsServerInSync(serverHost)
}

function setIsServerInSync(serverHost: string): void {
  const serverSyncInfo = state.serverSyncInfoMap[serverHost]
  serverSyncInfo.inSync = getIsServerInSync(serverHost)
}

function getIsRepoInSyncWithServer(
  serverHost: string,
  repoId: string
): boolean {
  const serverSyncInfo = state.serverSyncInfoMap[serverHost]
  const repoSyncInfo = serverSyncInfo.repos[repoId]
  return repoSyncInfo.inSync
}

function getIsServerInSync(serverHost: string): boolean {
  const serverSyncInfo = state.serverSyncInfoMap[serverHost]
  return Object.values(serverSyncInfo.repos).every(repo => repo.inSync)
}

function getIsNetworkInSync(serverCount: number): boolean {
  return countServersInSync() === serverCount
}

function countServersInSync(): number {
  return Object.values(state.serverSyncInfoMap).reduce(
    (count, serverSyncInfo) => count + (serverSyncInfo.inSync ? 1 : 0),
    0
  )
}
function countReposInSync(): number {
  let count = 0
  state.repos.forEach((_, repoId) => {
    count += getIsRepoSynced(repoId) ? 1 : 0
  })
  return count
}

const getIsRepoSynced = (repoId: string): boolean => {
  return Object.keys(state.serverSyncInfoMap).every(serverHost =>
    getIsRepoInSyncWithServer(serverHost, repoId)
  )
}

const checkmarkify = (bool: boolean): string => (bool ? '✓' : '𐄂')

const generateRepoIds = (repoPrefix: string, count: number): string[] => {
  const arr = []
  for (let i = 0; i < count; ++i) {
    arr.push(makeRepoId(i, repoPrefix))
  }
  return arr
}

const generateSyncInfoMap = (
  serverUrls: string[],
  repoIds: string[]
): ServerSyncInfoMap => {
  const map: ServerSyncInfoMap = {}

  for (const serverUrl of serverUrls) {
    const serverHost = new URL('', serverUrl).host
    const repos: RepoSyncInfoMap = {}

    for (const repoId of repoIds) {
      repos[repoId] = {
        inSync: true
      }
    }

    map[serverHost] = {
      inSync: true,
      repos
    }
  }

  return map
}

// Startup

try {
  const argv = minimist(process.argv.slice(2))
  const jsonArg = argv._[0]
  let configJson: string | undefined = jsonArg
  const configFile = argv.config

  if (configFile != null) {
    configJson = readFileSync(join(process.cwd(), configFile), 'utf-8')
  }

  if (configJson == null) {
    errHandler(
      [
        `Usage:`,
        `  yarn test.stress --config=config.stress.json`,
        `  yarn test.stress $json`,
        ``,
        `Example JSON Config:`,
        JSON.stringify(configSample, null, 2)
      ].join('\n')
    )
  }

  config = asConfig(JSON.parse(configJson))

  main().catch(errHandler)
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
  console.error(err)
  process.exit(1)
}
