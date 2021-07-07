import { ChildProcess, fork } from 'child_process'
import { makeConfig } from 'cleaner-config'
import minimist from 'minimist'
import { join } from 'path'
import pino from 'pino'

import { asConfig, Config, configSample } from './config'
import {
  AllEvents,
  asAllEvents,
  NetworkSyncEvent,
  ReadEvent,
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
import { prettyPrintObject } from './utils/printing'
import { compareHash } from './utils/repo-hash'
import { makeSyncKey, msToPerSeconds } from './utils/utils'

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info'
})

// Types

interface State {
  startTime: number
  syncKeys: string[]
  repos: RepoStateMap
  serverSyncInfoMap: ServerSyncInfoMap
}

type RepoStateMap = Map<string, RepoState>
interface RepoState {
  syncKey: string
  serverHost: string
  updateRequestTime: number
  repoHash: string
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

interface Snapshot {
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
  logger.info({ msg: 'starting repo-sync test', config })

  // Initialize state
  state = {
    startTime: Date.now(),
    syncKeys: [],
    repos: new Map(),
    serverSyncInfoMap: {}
  }

  const serverUrls = Object.values(config.clusters).reduce<string[]>(
    (allUrls, urls) => {
      return [...allUrls, ...urls]
    },
    []
  )
  serverCount = serverUrls.length

  // Generate an array of unique repo IDs of configured repoCount length
  const syncKeys = generateSyncKeys(config.syncKeyPrefix, config.repoCount)

  // Generate Sync Server Info for each server and host
  state.serverSyncInfoMap = makeSyncInfoMap(serverUrls)

  logger.debug({ msg: 'syncKeys generated', syncKeys })

  // Worker Cluster Process
  // ---------------------------------------------------------------------
  // spawn
  const workerCluster = fork(join(__dirname, 'worker-cluster'))
  // events
  workerCluster.on('message', payload => {
    try {
      const output = asAllEvents(payload)
      onEvent(output)
    } catch (err) {
      logger.error({ msg: 'worker cluster output error', err, payload })
      exit('worker exception')
    }
  })
  workerCluster.on('exit', (code): void => {
    if (code !== null && code !== 0) {
      exit(
        'worker exception',
        new Error(`Worker master exited with code ${String(code)}`)
      )
    }
  })

  // Start Inital Worker Routines
  // ---------------------------------------------------------------------
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

  // Log a snapshot every 30 seconds
  intervalIds.push(setInterval(logSnapshot, 30000))

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
      [
        `${countServersInSync()} / ${serverCount} servers in-sync`,
        ...Object.entries(state.serverSyncInfoMap).map(
          ([serverHost, { inSync }]) => `${checkmarkify(inSync)} ${serverHost}`
        )
      ].join(' | '),
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

    logger.trace({
      msg: 'status',
      status: [
        ...statusHeader,
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
        prettyPrintObject({
          'Total reads': `${repoReadTimeMetric.total}`,
          'Avg repo read time': `${repoReadTimeMetric.avg}ms`,
          'Avg repo read / sec': `${msToPerSeconds(repoReadTimeMetric.avg)}`
        }),
        prettyPrintObject({
          'Total repo replications': `${repoReplicationTimeMetric.total}`,
          'Avg repo replication time': `${repoReplicationTimeMetric.avg}ms`,
          'Max repo replication time': `${repoReplicationTimeMetric.max}ms`
        }),
        prettyPrintObject({
          'Total repo syncs': `${repoSyncTimeMetric.total}`,
          'Avg repo sync time': `${repoSyncTimeMetric.avg}ms`,
          'Max repo sync time': `${repoSyncTimeMetric.max}ms`
        }),
        prettyPrintObject({
          'Total server syncs': `${serverSyncMetric.total}`,
          'Avg server sync time': `${serverSyncMetric.avg}ms`,
          'Max server sync time': `${serverSyncMetric.max}ms`
        }),
        prettyPrintObject({
          'Total network syncs': `${networkSyncMetric.total}`,
          'Avg network sync time': `${networkSyncMetric.avg}ms`,
          'Max network sync time': `${networkSyncMetric.max}ms`
        })
      ]
    })

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
      logger.warn({ err: event.err, process: event.process })
      break
    case 'message':
      logger.info({ msg: 'message', event })
      break
    case 'ready':
      onReadyEvent(event)
      break
    case 'update':
      onUpdateEvent(event)
      break
    case 'read':
      onReadEvent(event, onEvent)
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
  const { requestTime, serverHost, syncKey, serverRepoHash } = readyEvent

  state.repos.set(syncKey, {
    syncKey,
    serverHost,
    updateRequestTime: requestTime,
    repoHash: serverRepoHash,
    syncTimeInstrument: makeInstrument()
  })

  logger.debug({ msg: 'ready', serverHost, syncKey, requestTime })
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
    serverRepoHash,
    payloadSize
  } = updateEvent

  const repoState = state.repos.get(syncKey)

  if (repoState == null) {
    throw new Error('Missing repo state')
  }

  if (compareHash(serverRepoHash, repoState.repoHash) === 'ahead') {
    state.repos.set(syncKey, {
      ...repoState,
      updateRequestTime: requestTime,
      repoHash: serverRepoHash,
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

  logger.debug({
    msg: 'write',
    requestTime,
    serverHost,
    syncKey,
    serverRepoHash,
    payloadSize: payloadSize != null ? `${payloadSize} bytes` : undefined
  })
}

function onReadEvent(
  readEvent: ReadEvent,
  onEvent: (output: AllEvents) => void
): void {
  const { serverHost, syncKey } = readEvent
  const repoState = state.repos.get(syncKey)

  const repoReadTime = endInstrument(repoReadTimeInstrument, Date.now())
  startInstrument(repoReadTimeInstrument, Date.now())

  addToMetric(repoReadTimeMetric, repoReadTime)

  if (repoState == null) {
    logger.error({
      msg: 'repo not ready',
      event: readEvent,
      syncKey
    })
    return
  }

  const status = compareHash(readEvent.serverRepoHash, repoState.repoHash)

  const wasRepoReplicated = getIsRepoInSyncWithServer(serverHost, syncKey)
  const wasRepoInSync = getIsRepoSynced(syncKey)
  const wasServerInSync = getIsServerInSync(serverHost)
  const wasNetworkInSync = getIsNetworkInSync(serverCount)

  if (status === 'current' && !wasRepoReplicated) {
    onEvent({
      type: 'replication',
      timestamp: readEvent.requestTime,
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
        timestamp: readEvent.requestTime,
        syncKey
      })
    }
    // If server is now in-sync, emit a server-sync event
    if (!wasServerInSync && isServerInSync) {
      onEvent({
        type: 'server-sync',
        timestamp: readEvent.requestTime,
        serverHost
      })
    }
    // If network is now in-sync, emit a network-sync event
    if (!wasNetworkInSync && isNetworkInSync) {
      onEvent({
        type: 'network-sync',
        timestamp: readEvent.requestTime
      })
    }
  } else if (status === 'behind' && wasRepoReplicated) {
    // If repo was in-sync, then track repo out-of-sync time
    if (wasRepoInSync) {
      startInstrument(repoState.syncTimeInstrument, readEvent.requestTime)
    }

    // If server was in-sync, then track server out-of-sync time
    if (wasServerInSync) {
      startInstrument(serverSyncInstrument, readEvent.requestTime)
    }

    // If network was in-sync, then track network out-of-sync time
    if (wasNetworkInSync) {
      startInstrument(networkSyncInstrument, readEvent.requestTime)
    }

    setIsRepoInSyncWithServer(serverHost, syncKey, false)

    logger.debug({
      msg: 'behind',
      serverHost,
      syncKey,
      requestTime: readEvent.requestTime
    })
  } else if (['ahead', 'conflicting'].includes(status)) {
    logger.debug({
      msg: status,
      serverHost,
      syncKey,
      requestTime: readEvent.requestTime
    })
  }
}

// Repo replicated from server where it was updated to another server
function onReplication(syncEvent: ReplicationEvent): void {
  const { timestamp, serverHost, syncKey } = syncEvent
  const repoState = state.repos.get(syncKey)

  if (repoState == null) {
    logger.error({
      msg: 'repo not ready',
      event: syncEvent,
      syncKey
    })
    return
  }

  const repoReplicationTime = timestamp - repoState.updateRequestTime

  addToMetric(repoReplicationTimeMetric, repoReplicationTime)
  setIsRepoInSyncWithServer(serverHost, syncKey, true)

  logger.debug({
    msg: 'replication',
    serverHost,
    syncKey,
    timestamp,
    replicationTime: `${repoReplicationTime}ms`
  })
}

// Repo is now in-sync with all servers
function onRepoSync(repoSyncEvent: RepoSyncEvent): void {
  const { timestamp, syncKey } = repoSyncEvent
  const repoState = state.repos.get(syncKey)

  if (repoState == null) {
    logger.debug({
      msg: 'repo not ready',
      event: repoSyncEvent,
      syncKey
    })
    return
  }

  const repoSyncTime = endInstrument(repoState.syncTimeInstrument, timestamp)

  addToMetric(repoSyncTimeMetric, repoSyncTime)

  logger.debug({ msg: 'repo-sync', syncKey, timestamp })
}

// Server is now in-sync with every repo
function onServerSync(serverSyncEvent: ServerSyncEvent): void {
  const { timestamp, serverHost } = serverSyncEvent
  const serverSyncTime = endInstrument(serverSyncInstrument, timestamp)
  addToMetric(serverSyncMetric, serverSyncTime)

  logger.debug({
    msg: 'server-sync',
    serverHost,
    timestamp,
    serverSyncTime: `${serverSyncTime}ms`
  })
}

// Each server is now in-sync with each other server (no inconsistent state)
function onNetworkSync(networkSyncEvent: NetworkSyncEvent): void {
  const { timestamp } = networkSyncEvent
  const networkSyncTime = endInstrument(networkSyncInstrument, timestamp)

  addToMetric(networkSyncMetric, networkSyncTime)

  logger.debug({
    msg: 'net-sync',
    timestamp,
    networkSyncTime: `${networkSyncTime}ms`
  })
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

const logSnapshot = (): void => {
  const snapshot: Snapshot = {
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

  logger.info({ msg: 'snapshot', ...snapshot })
}

// Startup

try {
  const argv = minimist(process.argv.slice(2))
  const jsonArg = argv._[0]
  const configJson: string | undefined = jsonArg
  const configFile = process.env.CONFIG ?? 'config.test.repo-sync.json'

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
        `  yarn test.repo-sync`,
        `  CONFIG=config.custom.json yarn test.repo-sync`,
        `  yarn test.repo-sync $json`,
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
  // Final output snapshot
  logSnapshot()

  // Log error if passed
  if (error != null) {
    logger.error(error)
  }

  // Log reason for exiting
  logger.info({ msg: 'finished repo-sync tests', reason })

  process.exit(error == null ? 0 : 1)
}
