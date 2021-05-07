import { eq, gt, toFixed } from 'biggystring'
import { ChildProcess, fork } from 'child_process'
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
  ReplicationEvent,
  RepoSyncEvent,
  ServerSyncEvent,
  UpdateEvent,
  WorkerConfig
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
import { makeSyncKey, msToPerSeconds } from './utils/utils'

// Types

interface State {
  startTime: number
  syncKeys: string[]
  repos: RepoStateMap
  serverSyncInfoMap: ServerSyncInfoMap
  output: Output
}

type RepoStateMap = Map<string, RepoState>
interface RepoState {
  syncKey: string
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
  [syncKey: string]: RepoSyncInfo
}
interface RepoSyncInfo {
  inSync: boolean
}

interface Output {
  reason: string
  errors: any[]
  config: Config
  snapshots: Snapshot[]
}
interface Snapshot {
  timestamp: number
  datetime: string
  repos: {
    count: number
  }
  payloadBytes: SnapshotSizeMetrics
  updates: SnapshotTimeMetrics
  reads: SnapshotTimeMetrics
  repoReplications: SnapshotTimeMetrics
  repoSyncs: SnapshotTimeMetrics
}
interface SnapshotSizeMetrics {
  total: number
  avg: number
  min: number
  max: number
}
interface SnapshotTimeMetrics {
  total: number
  avgPerSec: number
  avgTimeInMs: number
  maxTimeInMs: number
}

// State:

let config: Config
let serverCount: number = 0

// Metrics
const bytesMetric = makeMetric()
const repoUpdateTimeMetric = makeMetric()
const repoReadTimeMetric = makeMetric()
const repoReplicationTimeMetric = makeMetric()
const repoSyncTimeMetric = makeMetric()
const serverSyncMetric = makeMetric()
const networkSyncMetric = makeMetric()

// Instruments
const repoUpdateTimeInstrument = makeInstrument()
const repoReadTimeInstrument = makeInstrument()
const serverSyncInstrument = makeInstrument()
const networkSyncInstrument = makeInstrument()

let state: State

async function main(): Promise<void> {
  // Initialize state
  state = {
    startTime: Date.now(),
    syncKeys: [],
    repos: new Map(),
    serverSyncInfoMap: {},
    output: {
      reason: 'unknown',
      config,
      snapshots: [],
      errors: []
    }
  }

  print(`Verbosity: ${String(config.verbose)}`)

  const serverUrls = Object.values(config.clusters).reduce<string[]>(
    (allUrls, urls) => {
      return [...allUrls, ...urls]
    },
    []
  )
  serverCount = serverUrls.length

  print(`Generating random repos...`)
  // Generate an array of unique repo IDs of configured repoCount length
  const syncKeys = generateSyncKeys(config.syncKeyPrefix, config.repoCount)

  // Generate Sync Server Info for each server and host
  state.serverSyncInfoMap = makeSyncInfoMap(serverUrls)

  if (config.verbose) {
    print(`Repos:\n  ${syncKeys.join('\n  ')}`)
    print(`Servers:\n  ${serverUrls.join('\n  ')}`)
  }

  // Worker Cluster Process
  // ---------------------------------------------------------------------
  print(`Forking worker cluster processes...`)
  // spawn
  const workerCluster = fork(join(__dirname, 'worker-cluster.ts'))
  // events
  workerCluster.on('message', payload => {
    try {
      const output = asAllEvents(payload)
      onEvent(output)
    } catch (error) {
      if (error instanceof TypeError) {
        print('!!! worker payload', { payload })
        exit(
          'worker exception',
          new Error(`Invalid worker cluster output: ${error.message}`)
        )
      }
      exit('worker exception', error)
    }
  })
  workerCluster.on('exit', (code): void => {
    if (code !== null && code !== 0) {
      exit(
        'worker exception',
        new Error(`Worker cluster process exited with code ${String(code)}`)
      )
    }
    print('! worker cluster process finished')
  })

  // Start Inital Worker Routines
  // ---------------------------------------------------------------------
  print(`Starting worker cluster routines (${syncKeys.length})...`)
  syncKeys.forEach(syncKey => startWorkerRoutine(workerCluster, syncKey))

  const intervalIds: NodeJS.Timeout[] = []

  // Increase repo count every minute
  function repoCountIncreaser(): void {
    const numOfExistingRepos = state.syncKeys.length
    const numOfExistingReposUpdated = Math.min(
      numOfExistingRepos * config.repoCountIncreaseRatePerMin,
      config.maxRepoCount
    )
    const numOfNewRepos = Math.round(
      numOfExistingReposUpdated - numOfExistingRepos
    )

    if (numOfExistingRepos + numOfNewRepos > config.maxRepoCount) {
      return
    }

    printLog('repo-increase', numOfNewRepos)

    for (let i = 0; i < numOfNewRepos; ++i) {
      const newSyncKey = makeSyncKey(
        state.syncKeys.length,
        config.syncKeyPrefix
      )
      startWorkerRoutine(workerCluster, newSyncKey)
      printLog('new-repo', newSyncKey)
    }
  }
  intervalIds.push(setInterval(repoCountIncreaser, 60000))

  // Take a snapshot every 30 seconds
  function snapshotTaker(): void {
    takeSnapshot()
  }
  intervalIds.push(setInterval(snapshotTaker, 30000))

  function statusUpdater(): void {
    const now = Date.now()
    const timeSinceNetworkOutOfSync = measureInstrument(
      networkSyncInstrument,
      now
    )

    // Most stale repo is the repo with the largest out of sync time
    const repoStates = Array.from(state.repos.values())
    const mostStaleRepo =
      repoStates.length !== 0
        ? repoStates.reduce((repoStateA, repoStateB) => {
            return measureInstrument(repoStateA.syncTimeInstrument, now) >
              measureInstrument(repoStateB.syncTimeInstrument, now)
              ? repoStateA
              : repoStateB
          })
        : undefined
    const maxRepoSyncTime =
      mostStaleRepo != null
        ? measureInstrument(mostStaleRepo.syncTimeInstrument, now)
        : 0

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
        `${countReposInSync()} / ${state.syncKeys.length} repos in-sync`,
        ...(mostStaleRepo != null && !getIsRepoSynced(mostStaleRepo.syncKey)
          ? [
              `maximum ${maxRepoSyncTime}ms since repo out of sync`,
              `stale repo ${mostStaleRepo.syncKey}`
            ]
          : [])
      ].join(' | ')
    ]

    statusBox(
      [
        ...statusHeader,
        statusBarLine(),
        prettyPrintObject({
          'Total updates': `${repoUpdateTimeMetric.total} / ${
            config.maxUpdatesPerRepo * state.syncKeys.length
          }`,
          'Avg repo update time': `${repoUpdateTimeMetric.avg}ms`,
          'Avg repo update / sec': `${msToPerSeconds(
            repoUpdateTimeMetric.avg
          )}`,
          'Total bytes sent': `${bytesMetric.sum}`
        }),
        statusBarLine(),
        prettyPrintObject({
          'Total reads': `${repoReadTimeMetric.total}`,
          'Avg repo read time': `${repoReadTimeMetric.avg}ms`,
          'Avg repo read / sec': `${msToPerSeconds(repoReadTimeMetric.avg)}`
        }),
        statusBarLine(),
        prettyPrintObject({
          'Total repo replications': `${repoReplicationTimeMetric.total}`,
          'Avg repo replication time': `${repoReplicationTimeMetric.avg}ms`,
          'Max repo replication time': `${repoReplicationTimeMetric.max}ms`
        }),
        statusBarLine(),
        prettyPrintObject({
          'Total repo syncs': `${repoSyncTimeMetric.total}`,
          'Avg repo sync time': `${repoSyncTimeMetric.avg}ms`,
          'Max repo sync time': `${repoSyncTimeMetric.max}ms`
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
      repoUpdateTimeMetric.total >=
        config.maxUpdatesPerRepo * state.syncKeys.length &&
      getIsNetworkInSync(serverCount)
    ) {
      exitGracefully('completed max operations')
    }

    if (
      config.repoSyncTimeout !== 0 &&
      maxRepoSyncTime > config.repoSyncTimeout
    ) {
      exitGracefully('exceeded sync timeout')
    }
  }
  intervalIds.push(setInterval(statusUpdater, 100))

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
    repoUpdatesPerMin: config.repoUpdatesPerMin,
    repoReadsPerMin: config.repoReadsPerMin,
    repoCheckDelayInSeconds: config.repoCheckDelayInSeconds,
    repoUpdateIncreaseRate: config.repoUpdateIncreaseRate,
    maxUpdatesPerRepo: config.maxUpdatesPerRepo,
    fileByteSizeRange: config.fileByteSizeRange,
    fileCountRange: config.fileCountRange
  }
  workerCluster.send(workerConfig)

  state.syncKeys.push(syncKey)
  addRepoToSyncInfoMap(syncKey)
}

function onEvent(event: AllEvents): void {
  switch (event.type) {
    case 'error':
      printLog('error', event.process, event.message)
      state.output.errors.push(event)
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
    case 'replication':
      onReplication(event)
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

function onReadyEvent(readyEvent: ReadyEvent): void {
  const { requestTime, serverHost, syncKey, serverRepoTimestamp } = readyEvent

  state.repos.set(syncKey, {
    syncKey,
    serverHost,
    updateRequestTime: requestTime,
    repoTimestamp: serverRepoTimestamp,
    syncTimeInstrument: makeInstrument()
  })

  printLog('ready', serverHost, syncKey, requestTime)
}

function onUpdateEvent(updateEvent: UpdateEvent): void {
  const repoUpdateTime = endInstrument(repoUpdateTimeInstrument, Date.now())
  startInstrument(repoUpdateTimeInstrument, Date.now())

  addToMetric(repoUpdateTimeMetric, repoUpdateTime)
  addToMetric(bytesMetric, updateEvent.payloadSize)

  const {
    requestTime,
    serverHost,
    syncKey,
    serverRepoTimestamp,
    payloadSize
  } = updateEvent

  const repoState = state.repos.get(syncKey)

  if (repoState == null) {
    throw new Error('Missing repo state')
  }

  if (gt(serverRepoTimestamp, repoState.repoTimestamp)) {
    state.repos.set(syncKey, {
      ...repoState,
      updateRequestTime: requestTime,
      repoTimestamp: serverRepoTimestamp,
      serverHost
    })
  }

  // All servers except for the server which facilitated the update are assumed
  // to not have replicated repo's update
  const allOtherServerHosts = Object.keys(state.serverSyncInfoMap).filter(
    host => host !== serverHost
  )
  allOtherServerHosts.forEach(host => {
    // If repo was in-sync, then track repo out-of-sync time
    if (repoState.syncTimeInstrument.start === null) {
      startInstrument(repoState.syncTimeInstrument, updateEvent.requestTime)
    }
    // If server was in-sync, then track server out-of-sync time
    if (serverSyncInstrument.start === null) {
      startInstrument(serverSyncInstrument, updateEvent.requestTime)
    }
    // If network was in-sync, then track network out-of-sync time
    if (networkSyncInstrument.start === null) {
      startInstrument(networkSyncInstrument, updateEvent.requestTime)
    }
    setIsRepoInSyncWithServer(host, syncKey, false)
  })

  printLog(
    'write',
    requestTime,
    serverHost,
    syncKey,
    serverRepoTimestamp,
    payloadSize != null ? `${payloadSize} bytes` : ''
  )
}

function onCheckEvent(
  checkEvent: CheckEvent,
  onEvent: (output: AllEvents) => void
): void {
  const { serverHost, syncKey } = checkEvent
  const repoState = state.repos.get(syncKey)

  const repoReadTime = endInstrument(repoReadTimeInstrument, Date.now())
  startInstrument(repoReadTimeInstrument, Date.now())

  addToMetric(repoReadTimeMetric, repoReadTime)

  if (repoState == null) {
    printLog('checker', 'repo not ready', syncKey)
    return
  }

  const status = eq(checkEvent.serverRepoTimestamp, repoState.repoTimestamp)
    ? 'replicated'
    : gt(checkEvent.serverRepoTimestamp, repoState.repoTimestamp)
    ? gt(toFixed(checkEvent.serverRepoTimestamp, 0, 0), repoState.repoTimestamp)
      ? 'ahead'
      : 'conflicting'
    : 'behind'

  const wasRepoReplicated = getIsRepoInSyncWithServer(serverHost, syncKey)
  const wasRepoInSync = getIsRepoSynced(syncKey)
  const wasServerInSync = getIsServerInSync(serverHost)
  const wasNetworkInSync = getIsNetworkInSync(serverCount)

  if (status === 'replicated' && !wasRepoReplicated) {
    onEvent({
      type: 'replication',
      timestamp: checkEvent.requestTime,
      serverHost,
      syncKey
    })

    const isRepoSynced = getIsRepoSynced(syncKey)
    const isServerInSync = getIsServerInSync(serverHost)
    const isNetworkInSync = getIsNetworkInSync(serverCount)

    // If repo is now in-sync, emit a repo-sync event
    if (!wasRepoInSync && isRepoSynced) {
      onEvent({
        type: 'repo-sync',
        timestamp: checkEvent.requestTime,
        syncKey
      })
    }
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
  } else if (status === 'behind' && wasRepoReplicated) {
    // If repo was in-sync, then track repo out-of-sync time
    if (wasRepoInSync) {
      startInstrument(repoState.syncTimeInstrument, checkEvent.requestTime)
    }

    // If server was in-sync, then track server out-of-sync time
    if (wasServerInSync) {
      startInstrument(serverSyncInstrument, checkEvent.requestTime)
    }

    // If network was in-sync, then track network out-of-sync time
    if (wasNetworkInSync) {
      startInstrument(networkSyncInstrument, checkEvent.requestTime)
    }

    setIsRepoInSyncWithServer(serverHost, syncKey, false)

    printLog('behind', serverHost, syncKey, checkEvent.requestTime)
  } else if (['ahead', 'conflicting'].includes(status)) {
    printLog(status, serverHost, syncKey, checkEvent.requestTime)
  }
}

// Repo replicated from server where it was updated to another server
function onReplication(syncEvent: ReplicationEvent): void {
  const { timestamp, serverHost, syncKey } = syncEvent
  const repoState = state.repos.get(syncKey)

  if (repoState == null) {
    printLog('worker', 'repo not ready', syncKey)
    return
  }

  const repoReplicationTime = timestamp - repoState.updateRequestTime

  addToMetric(repoReplicationTimeMetric, repoReplicationTime)
  setIsRepoInSyncWithServer(serverHost, syncKey, true)

  printLog(
    'replication',
    serverHost,
    syncKey,
    timestamp,
    `${repoReplicationTime}ms`
  )
}

// Repo is now in-sync with all servers
function onRepoSync(repoSyncEvent: RepoSyncEvent): void {
  const { timestamp, syncKey } = repoSyncEvent
  const repoState = state.repos.get(syncKey)

  if (repoState == null) {
    printLog('worker', 'repo not ready', syncKey)
    return
  }

  const repoSyncTime = endInstrument(repoState.syncTimeInstrument, timestamp)

  addToMetric(repoSyncTimeMetric, repoSyncTime)

  printLog('repo-sync', syncKey, timestamp)
}

// Server is now in-sync with every repo
function onServerSync(serverSyncEvent: ServerSyncEvent): void {
  const { timestamp, serverHost } = serverSyncEvent
  const serverSyncTime = endInstrument(serverSyncInstrument, timestamp)
  addToMetric(serverSyncMetric, serverSyncTime)

  printLog('server-sync', serverHost, timestamp, `${serverSyncTime}ms`)
}

// Each server is now in-sync with each other server (no inconsistent state)
function onNetworkSync(networkSyncEvent: NetworkSyncEvent): void {
  const { timestamp } = networkSyncEvent
  const networkSyncTime = endInstrument(networkSyncInstrument, timestamp)

  addToMetric(networkSyncMetric, networkSyncTime)

  printLog('net-sync', timestamp, `${networkSyncTime}ms`)
}

function setIsRepoInSyncWithServer(
  serverHost: string,
  syncKey: string,
  inSync: boolean
): void {
  const serverSyncInfo = state.serverSyncInfoMap[serverHost]
  const repoSyncInfo = serverSyncInfo.repos[syncKey]
  repoSyncInfo.inSync = inSync
  setIsServerInSync(serverHost)
}
function getIsRepoInSyncWithServer(
  serverHost: string,
  syncKey: string
): boolean {
  const serverSyncInfo = state.serverSyncInfoMap[serverHost]
  const repoSyncInfo = serverSyncInfo.repos[syncKey]
  return repoSyncInfo.inSync
}

function setIsServerInSync(serverHost: string): void {
  const serverSyncInfo = state.serverSyncInfoMap[serverHost]
  serverSyncInfo.inSync = getIsServerInSync(serverHost)
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
  state.repos.forEach((_, syncKey) => {
    count += getIsRepoSynced(syncKey) ? 1 : 0
  })
  return count
}

const getIsRepoSynced = (syncKey: string): boolean => {
  return Object.keys(state.serverSyncInfoMap).every(serverHost =>
    getIsRepoInSyncWithServer(serverHost, syncKey)
  )
}

const checkmarkify = (bool: boolean): string => (bool ? '✓' : '𐄂')

const generateSyncKeys = (syncKeyPrefix: string, count: number): string[] => {
  const arr = []
  for (let i = 0; i < count; ++i) {
    arr.push(makeSyncKey(i, syncKeyPrefix))
  }
  return arr
}

const makeSyncInfoMap = (serverUrls: string[]): ServerSyncInfoMap => {
  const map: ServerSyncInfoMap = {}

  for (const serverUrl of serverUrls) {
    const serverHost = new URL('', serverUrl).host

    map[serverHost] = {
      inSync: true,
      repos: {}
    }
  }

  return map
}

const addRepoToSyncInfoMap = (syncKey: string): void => {
  Object.values(state.serverSyncInfoMap).forEach(serverSyncInfo => {
    if (serverSyncInfo.repos[syncKey] != null) {
      throw new Error(`Repo already exist in state: ${syncKey}`)
    }
    serverSyncInfo.repos[syncKey] = { inSync: true }
  })
}

const takeSnapshot = (): Snapshot => {
  const timestamp = Date.now()
  const datetime = new Date(timestamp).toLocaleString()
  const snapshot: Snapshot = {
    timestamp,
    datetime,
    repos: {
      count: state.syncKeys.length
    },
    payloadBytes: {
      total: bytesMetric.sum,
      avg: bytesMetric.avg,
      min: bytesMetric.min,
      max: bytesMetric.max
    },
    updates: {
      total: repoUpdateTimeMetric.total,
      avgPerSec:
        repoUpdateTimeMetric.avg !== 0 ? 1000 / repoUpdateTimeMetric.avg : 0,
      avgTimeInMs: repoUpdateTimeMetric.avg,
      maxTimeInMs: repoUpdateTimeMetric.max
    },
    reads: {
      total: repoReadTimeMetric.total,
      avgPerSec:
        repoReadTimeMetric.avg !== 0 ? 1000 / repoReadTimeMetric.avg : 0,
      avgTimeInMs: repoReadTimeMetric.avg,
      maxTimeInMs: repoReadTimeMetric.max
    },
    repoReplications: {
      total: repoReplicationTimeMetric.total,
      avgPerSec:
        repoReplicationTimeMetric.avg !== 0
          ? 1000 / repoReplicationTimeMetric.avg
          : 0,
      avgTimeInMs: repoReplicationTimeMetric.avg,
      maxTimeInMs: repoReplicationTimeMetric.max
    },
    repoSyncs: {
      total: repoSyncTimeMetric.total,
      avgPerSec:
        repoSyncTimeMetric.avg !== 0 ? 1000 / repoSyncTimeMetric.avg : 0,
      avgTimeInMs: repoSyncTimeMetric.avg,
      maxTimeInMs: repoSyncTimeMetric.max
    }
  }

  state.output.snapshots.push(snapshot)

  return snapshot
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

  process.env.VERBOSE = config.verbose ? '1' : '0'

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
  // Handle error strings as CLI error message
  if (typeof err === 'string') {
    console.error(err)
    process.exit(1)
  }

  exit('exception', err)
}

function exit(reason: string, error?: Error): void {
  // Print reason for exiting
  print(`!!! ${reason}`)

  // Final output snapshot
  takeSnapshot()

  state.output.reason = reason

  if (error != null) {
    state.output.errors.push({
      name: error.name,
      message: error.message,
      stack: error.stack
    })
  }

  console.log(
    JSON.stringify(state.output, null, process.env.VERBOSE === '1' ? 2 : 0)
  )
  process.exit(error == null ? 0 : 1)
}
