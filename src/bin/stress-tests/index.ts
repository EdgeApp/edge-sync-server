import { eq, gt, toFixed } from 'biggystring'
import { ChildProcess, fork } from 'child_process'
import { join } from 'path'

import { TimestampRev } from '../../types'
import { Config, config } from './config'
import {
  AllEvents,
  asAllEvents,
  CheckerInput,
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
  statusHeader: string
  repos: RepoStateMap
  serverSyncInfoMap: ServerSyncInfoMap
  output: {
    reason: string
    results: StressTestResult[]
  }
}

type RepoStateMap = Map<string, RepoState>
interface RepoState {
  updateRequestTime: number
  repoTimestamp: TimestampRev
  serverHost: string
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

interface StressTestResult {
  opRate: number
  avgOpsRate: number
  networkSyncTime: number
}

// State:

// Metrics
const opTimeMetric = makeMetric()
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
  statusHeader: 'Waiting on checker activity...',
  repos: new Map(),
  serverSyncInfoMap: {},
  output: {
    reason: '',
    results: []
  }
}

async function main(config: Config): Promise<void> {
  console.log(`Verbosity: ${String(config.verbose)}`)

  console.log(`Generating random repos...`)
  // Generate an array of unique repo IDs of configured repoCount length
  const repoIds = [...Array(config.repoCount)].reduce<string[]>(
    (arr, _, index) => {
      let repo: string
      // Use do..while to make sure the random repo is not already included in arr
      do {
        repo = makeRepoId(index, config.repoPrefix)
      } while (arr.includes(repo))
      arr.push(repo)
      return arr
    },
    []
  )

  const serverUrls = config.servers

  // Generate Sync Server Info for each server and host
  state.serverSyncInfoMap = serverUrls.reduce<ServerSyncInfoMap>(
    (map, serverUrl) => {
      const serverHost = new URL('', serverUrl).host
      const repos = repoIds.reduce<RepoSyncInfoMap>((map, repo) => {
        map[repo] = {
          inSync: true
        }
        return map
      }, {})
      map[serverHost] = {
        inSync: true,
        repos
      }
      return map
    },
    {}
  )

  if (config.verbose) {
    console.log(`Repos:\n  ${repoIds.join('\n  ')}`)
    console.log(`Servers:\n  ${serverUrls.join('\n  ')}`)
  }

  // Worker Process
  // ---------------------------------------------------------------------
  // args
  const workerInput: WorkerInput = {
    serverUrls,
    repoIds,
    maxOpsPerSecond: config.startOpsPerSec,
    maxOpCount: config.maxOpCount,
    fileCountRange: config.fileCountRange
  }
  const workerJsonInput = JSON.stringify(workerInput, null, 2)

  // spawn
  console.info('Forking worker process...')
  if (config.verbose) console.log(`Worker input:\n${workerJsonInput}`)
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

  // Checker Process
  // ---------------------------------------------------------------------
  // args
  const checkerInput: CheckerInput = {
    serverUrls,
    repoIds
  }
  const checkerJsonInput = JSON.stringify(checkerInput, null, 2)

  // spawn
  console.info('Forking checker process...')
  if (config.verbose) console.log(`Checker input:\n${checkerJsonInput}`)
  const checkerPs = fork(join(__dirname, 'checker.ts'), [checkerJsonInput])

  // events
  checkerPs.on('message', payload => {
    try {
      const output = asAllEvents(payload)
      onEvent(output)
    } catch (error) {
      if (error instanceof TypeError) {
        console.info({ payload })
        throw new Error(`Invalid checker output: ${error.message}`)
      }
    }
  })

  checkerPs.on('error', (err): void => {
    throw new Error(`Checker process error: ${err.stack ?? err.message}`)
  })
  checkerPs.on('exit', (code): void => {
    if (code !== null && code !== 0) {
      throw new Error(`Worker process exited with code ${String(code)}`)
    }
    print('! checker process finished')
  })

  function exit(reason: string): void {
    workerPs.kill('SIGTERM')
    checkerPs.kill('SIGTERM')
    clearInterval(statusUpdaterIntervalId)
    print(`!!! ${reason}`)
    state.output.reason = reason
    state.output.results = state.output.results.map(o => ({
      ...o,
      avgOpTime: 1 / o.avgOpsRate,
      exceeds: 1 / o.avgOpsRate > o.networkSyncTime
    }))
    console.log(JSON.stringify(state.output, null, 2))
    process.exit()
  }

  function statusUpdater(): void {
    const timeSinceNetworkOutOfSync = measureInstrument(
      networkSyncInstrument,
      Date.now()
    )
    const opsDone = opTimeMetric.total

    state.statusHeader = [
      [
        `${checkmarkify(getIsNetworkInSync())} network`,
        `${timeSinceNetworkOutOfSync}ms time since network sync `
      ].join(' | '),
      statusBarLine(),
      [
        `${countServersInSync()} / ${config.servers.length}`,
        ...Object.entries(state.serverSyncInfoMap).map(
          ([serverHost, { inSync }]) => `${checkmarkify(inSync)} ${serverHost}`
        )
      ].join(' | ')
    ].join('\n')

    const avgOpsPerSec = opTimeMetric.avg !== 0 ? 1000 / opTimeMetric.avg : 0

    // Exit cases
    if (
      config.maxOpCount > 0 &&
      opsDone >= config.maxOpCount &&
      getIsNetworkInSync()
    ) {
      exit('completed max operations')
    }
    if (
      config.syncTimeout > 0 &&
      timeSinceNetworkOutOfSync > config.syncTimeout
    ) {
      state.output.results.push({
        opRate: workerInput.maxOpsPerSecond,
        avgOpsRate: opTimeMetric.avg !== 0 ? 1000 / opTimeMetric.avg : 0,
        networkSyncTime: timeSinceNetworkOutOfSync
      })
      exit('exceeded sync timeout')
    }

    statusBox(
      [
        state.statusHeader,
        statusBarLine(),
        prettyPrintObject({
          'Total ops': `${opsDone}`,
          'Avg op time': `${opTimeMetric.avg}ms`,
          'Avg ops / sec': `${avgOpsPerSec}`,
          'Total bytes sent': `${bytesMetric.sum}`,
          'Total repo syncs': `${repoSyncMetric.total}`,
          'Avg repo sync time': `${repoSyncMetric.avg}ms`,
          'Max repo sync time': `${repoSyncMetric.max}ms`,
          'Total server syncs': `${serverSyncMetric.total}`,
          'Avg server sync time': `${serverSyncMetric.avg}ms`,
          'Max server sync time': `${serverSyncMetric.max}ms`,
          'Total network syncs': `${networkSyncMetric.total}`,
          'Avg network sync time': `${networkSyncMetric.avg}ms`,
          'Max network sync time': `${networkSyncMetric.max}ms`
        })
      ].join('\n')
    )
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
        onNetworkSync(event, workerInput, workerPs)
        break
    }
  }
}

function onReadyEvent(readyEvent: ReadyEvent): void {
  const { requestTime, serverHost, repoId, serverRepoTimestamp } = readyEvent

  state.repos.set(repoId, {
    updateRequestTime: requestTime,
    repoTimestamp: serverRepoTimestamp,
    serverHost
  })

  printLog('ready', serverHost, repoId, requestTime)
}

function onUpdateEvent(updateEvent: UpdateEvent): void {
  const opTime = endInstrument(opTimeInstrument, Date.now())
  startInstrument(opTimeInstrument, Date.now())

  addToMetric(opTimeMetric, opTime)
  addToMetric(bytesMetric, updateEvent.payloadSize)

  const {
    requestTime,
    serverHost,
    repoId,
    serverRepoTimestamp,
    payloadSize
  } = updateEvent

  const repoState = state.repos.get(repoId)

  if (repoState == null || gt(serverRepoTimestamp, repoState.repoTimestamp)) {
    state.repos.set(repoId, {
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

  const wasRepoInSync = getIsRepoInSync(serverHost, repoId)
  const wasServerInSync = getIsServerInSync(serverHost)
  const wasNetworkInSync = getIsNetworkInSync()

  if (status === 'replicated' && !wasRepoInSync) {
    onEvent({
      type: 'repo-sync',
      timestamp: checkEvent.requestTime,
      serverHost,
      repoId
    })

    const isServerInSync = getIsServerInSync(serverHost)
    const isNetworkInSync = getIsNetworkInSync()

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

  addToMetric(repoSyncMetric, timestamp - repoState.updateRequestTime)
  setIsRepoInSync(serverHost, repoId, true)

  printLog('sync', serverHost, repoId, timestamp)
}

function onServerSync(serverSyncEvent: ServerSyncEvent): void {
  const { timestamp, serverHost } = serverSyncEvent
  const serverSyncTime = endInstrument(serverSyncInstrument, timestamp)
  addToMetric(serverSyncMetric, serverSyncTime)

  printLog('server-sync', serverHost, serverSyncTime, timestamp)
}

function onNetworkSync(
  networkSyncEvent: NetworkSyncEvent,
  workerInput: WorkerInput,
  workerPs: ChildProcess
): void {
  const { timestamp } = networkSyncEvent
  const networkSyncTime = endInstrument(networkSyncInstrument, timestamp)

  addToMetric(networkSyncMetric, networkSyncTime)

  state.output.results.push({
    opRate: workerInput.maxOpsPerSecond,
    avgOpsRate: opTimeMetric.avg !== 0 ? 1000 / opTimeMetric.avg : 0,
    networkSyncTime
  })

  // Update the maxOpsPerSecond rate
  workerInput.maxOpsPerSecond =
    workerInput.maxOpsPerSecond * config.opIncreaseRate
  workerPs.send(workerInput)

  printLog('net-sync', networkSyncTime, workerInput.maxOpsPerSecond, timestamp)
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

function getIsRepoInSync(serverHost: string, repoId: string): boolean {
  const serverSyncInfo = state.serverSyncInfoMap[serverHost]
  const repoSyncInfo = serverSyncInfo.repos[repoId]
  return repoSyncInfo.inSync
}

function getIsServerInSync(serverHost: string): boolean {
  const serverSyncInfo = state.serverSyncInfoMap[serverHost]
  return Object.values(serverSyncInfo.repos).every(repo => repo.inSync)
}

function getIsNetworkInSync(): boolean {
  return countServersInSync() === config.servers.length
}

function countServersInSync(): number {
  return Object.values(state.serverSyncInfoMap).reduce(
    (count, serverSyncInfo) => count + (serverSyncInfo.inSync ? 1 : 0),
    0
  )
}

const checkmarkify = (bool: boolean): string => (bool ? '✓' : '𐄂')

// Startup

main(config).catch(errHandler)

process.on('unhandledRejection', error => {
  console.warn(`UNHANDLED PROMISE!!!`)
  if (error instanceof Error) errHandler(error)
})

function errHandler(err: Error): void {
  console.error(err)
  process.exit(1)
}
