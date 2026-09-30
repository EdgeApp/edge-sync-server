import cluster, { Worker } from 'cluster'
import { setupDatabase } from 'edge-server-tools'
import nano from 'nano'
import { cpus } from 'os'

import { config } from './config'
import { getSettingsDatabaseSetup, getSettingsDb } from './db/settings-db'
import { getStoreDatabaseSetup, getStoreDb } from './db/store-db'
import {
  asHubRequest,
  HUB_LOST,
  HubReply,
  isHubLost,
  makeChangeHub,
  makeIpcHubLink
} from './engine/changeHub'
import { makeCouchChangeSource } from './engine/changeSource'
import {
  asLimiterRequest,
  LimiterReply,
  makeConnectionCounter,
  makeIpcConnectionLimiter
} from './engine/connectionLimiter'
import { makeRepoChangeEngine } from './engine/repoChangeEngine'
import { logger } from './logger'
import { AppState, makeServer } from './server'
import { limitConcurrency } from './util/limit-concurrency'
import { getCheckpointAt } from './util/store/checkpoints'
import { makeWsServer } from './ws-server'

const numCPUs = cpus().length

const databases = [getStoreDatabaseSetup(config), getSettingsDatabaseSetup()]

const makeAppState = (): AppState => ({
  config,
  storeDb: getStoreDb(config.couchUri, config.storeDatabaseName),
  settingsDb: getSettingsDb(config.couchUri),
  dbServer: nano(config.couchUri)
})

if (cluster.isMaster) {
  // The master's jobs are forking and change fan-out. A CouchDB fault must
  // not take it down, so it logs and carries on; a dead feed is handled by
  // the engine's watchdog instead.
  process.on('uncaughtException', err => {
    logger.error({ msg: 'Uncaught exception in master', err })
  })
  process.on('unhandledRejection', err => {
    logger.error({ msg: 'Unhandled rejection in master', err })
  })

  Promise.all(
    databases.map(
      async setup =>
        await setupDatabase(config.couchUri, setup, {
          log: logger.info.bind(logger)
        })
    )
  )
    .then(() => startMaster())
    .catch(failStartup)
} else {
  const appState = makeAppState()
  const app = makeServer(appState)

  // Instantiate HTTP server
  const server = app.listen(config.httpPort, () => {
    logger.info(`HTTP server started listening on ${config.httpPort}.`)
  })

  // Instantiate WebSocket server
  const hub = makeChangeHub(makeIpcHubLink())
  const wsServer = makeWsServer(server, {
    config,
    hub,
    // A reconnect herd must not turn into thousands of concurrent view
    // queries against CouchDB:
    getCheckpoint: limitConcurrency(
      config.wsCheckpointConcurrency,
      getCheckpointAt(appState)
    ),
    limiter: makeIpcConnectionLimiter()
  })

  wsServer.wss.on('listening', () => {
    logger.info(`WebSocket server started.`)
  })

  // A master that is about to exit warns its workers first, so clients
  // hear `subLost` instead of an abnormal close. (Node exits a worker the
  // moment its IPC channel drops, before any 'disconnect' listener could
  // do this itself.)
  process.on('message', raw => {
    if (!isHubLost(raw)) return
    logger.error('The cluster master is exiting; dropping subscriptions')
    wsServer.loseAll()
  })
}

function startMaster(): void {
  const instanceCount = config.instanceCount ?? numCPUs
  const appState = makeAppState()
  let shuttingDown = false

  const engine = makeRepoChangeEngine({
    makeSource: makeCouchChangeSource({
      couchUri: config.couchUri,
      databaseName: config.storeDatabaseName,
      timeoutMs: config.changeFeedTimeoutMs
    }),
    getCheckpoint: getCheckpointAt(appState),
    deliver(workerId, updates) {
      const worker = cluster.workers?.[workerId]
      if (worker == null || !worker.isConnected()) return
      const reply: HubReply = { wsHub: 'updates', updates }
      worker.send(reply)
    },
    onFatal(reason) {
      // Clients of a host with a dead feed would wait forever. Tell them
      // their subscriptions are gone, then exit, so the process manager
      // restarts the host and clients resubscribe.
      logger.error({ msg: 'Repo change engine gave up; exiting', reason })
      for (const worker of Object.values(cluster.workers ?? {})) {
        if (worker?.isConnected() === true) worker.send(HUB_LOST)
      }
      setTimeout(() => process.exit(1), 1000)
    },
    log: {
      info: msg => logger.info(msg),
      warn: msg => logger.warn(msg),
      error: (msg, err) => logger.error({ msg, err })
    },
    coalesceMs: config.changeFeedCoalesceMs,
    feedTimeoutMs: config.changeFeedTimeoutMs,
    maxRestarts: config.changeFeedMaxRestarts
  })
  engine.start()

  // The per-IP socket cap, counted across every worker:
  const connections = makeConnectionCounter(config.wsMaxConnectionsPerIp)

  cluster.on('message', (worker: Worker, raw: unknown) => {
    let limiterRequest
    try {
      limiterRequest = asLimiterRequest(raw)
    } catch (error) {}
    if (limiterRequest != null) {
      if (limiterRequest.wsConn === 'release') {
        connections.release(worker.id, limiterRequest.ip)
        return
      }
      const reply: LimiterReply = {
        wsConn: 'reserved',
        id: limiterRequest.id,
        ok: connections.reserve(worker.id, limiterRequest.ip)
      }
      if (worker.isConnected()) worker.send(reply)
      return
    }

    let request
    try {
      request = asHubRequest(raw)
    } catch (error) {
      return // Not a hub message
    }
    if (request.wsHub === 'watch') {
      engine.addInterest(worker.id, request.repoIds)
      const reply: HubReply = { wsHub: 'ack', id: request.id }
      if (worker.isConnected()) worker.send(reply)
    } else {
      engine.removeInterest(worker.id, request.repoIds)
    }
  })

  // Fork workers.
  for (let i = 0; i < instanceCount; i++) {
    cluster.fork()
  }

  // Restart workers when they exit. A new worker starts with no
  // subscriptions; its clients reconnect and register again.
  cluster.on('exit', (worker, code, signal) => {
    engine.removeWorker(worker.id)
    connections.removeWorker(worker.id)
    if (shuttingDown) return
    logger.info(
      `Worker ${worker.process.pid} died with code ${code} and signal ${signal}`
    )
    logger.info(`Forking new worker process...`)
    cluster.fork()
  })

  const shutdown = (signal: string): void => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info(`Received ${signal}; stopping the change feed and workers`)
    engine.stop()
    for (const worker of Object.values(cluster.workers ?? {})) {
      worker?.kill('SIGTERM')
    }
    setTimeout(() => process.exit(0), 5000).unref()
    cluster.on('exit', () => {
      if (Object.keys(cluster.workers ?? {}).length === 0) process.exit(0)
    })
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

function failStartup(err: any): void {
  logger.error(err)
  process.exit(1)
}
