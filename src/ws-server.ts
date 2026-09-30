import { IncomingMessage, Server } from 'http'
import WebSocket from 'ws'

import {
  makeWsConnection,
  sendWsNotification,
  WsConnection
} from './adapters/makeWsConnection'
import { Config } from './config'
import { ChangeHub } from './engine/changeHub'
import {
  makeSubscriptionRegistry,
  SubscriptionRegistry
} from './engine/subscriptionRegistry'
import { allJsonRpcMethods } from './jsonrpc/allMethods'
import { logger } from './logger'
import { Checkpoint } from './types/checkpoints'

export const WS_PATH = '/api/v2/ws'

export interface WsServerContext {
  config: Config
  hub: ChangeHub
  getCheckpoint: (repoId: string) => Promise<Checkpoint>
}

export interface WsServer {
  wss: WebSocket.Server
  /** Sends `subLost` for every subscription and closes every socket. */
  loseAll: () => void
  /** Open sockets per client IP. */
  connectionCounts: () => Map<string, number>
  close: () => Promise<void>
}

/**
 * The client's IP. Behind the proxy on loopback, that is the address the
 * proxy appended last to `X-Forwarded-For`; earlier entries are whatever the
 * client chose to send.
 */
export const clientIp = (req: IncomingMessage): string => {
  const remote = req.socket.remoteAddress ?? ''
  const isLoopback =
    remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
  const forwarded = req.headers['x-forwarded-for']
  if (isLoopback && typeof forwarded === 'string') {
    const hops = forwarded.split(',').map(hop => hop.trim())
    const last = hops[hops.length - 1]
    if (last !== '') return last
  }
  return remote
}

export function makeWsServer(
  server: Server,
  context: WsServerContext
): WsServer {
  const { config, hub, getCheckpoint } = context
  const perIp = new Map<string, number>()
  const registries = new Set<SubscriptionRegistry>()
  const missedPongs = new Map<WebSocket, number>()

  const wss = new WebSocket.Server({
    server,
    path: WS_PATH,
    maxPayload: config.wsMaxPayload,
    verifyClient(info, done) {
      const ip = clientIp(info.req)
      if ((perIp.get(ip) ?? 0) >= config.wsMaxConnectionsPerIp) {
        logger.warn({ msg: 'WebSocket connection refused: per-IP cap', ip })
        done(false, 429, 'Too many connections')
        return
      }
      done(true)
    }
  })

  wss.on('connection', function connection(ws, req) {
    const ip = clientIp(req)
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1)
    missedPongs.set(ws, 0)

    const registry = makeSubscriptionRegistry({
      hub,
      getCheckpoint,
      maxSubscriptions: config.wsMaxSubscriptionsPerConnection,
      sendUpdate: updates => sendWsNotification(ws, 'update', updates),
      sendSubLost: repoIds => sendWsNotification(ws, 'subLost', repoIds)
    })
    registries.add(registry)

    const state: WsConnection = {
      isConnected: true,
      registry,
      limits: {
        maxReposPerSubscribe: config.wsMaxReposPerSubscribe,
        subscribeCallsPerMinute: config.wsSubscribeCallsPerMinute
      },
      subscribeCalls: []
    }
    makeWsConnection(ws, allJsonRpcMethods, state)
    logger.info({ msg: 'WebSocket connection opened', ip })

    let torn = false
    const teardown = (): void => {
      if (torn) return
      torn = true
      state.isConnected = false
      registry.close()
      registries.delete(registry)
      missedPongs.delete(ws)
      const count = (perIp.get(ip) ?? 1) - 1
      if (count <= 0) perIp.delete(ip)
      else perIp.set(ip, count)
    }
    ws.on('pong', () => missedPongs.set(ws, 0))
    ws.on('close', teardown)
    ws.on('error', err => {
      logger.warn({ msg: 'WebSocket error', err })
      teardown()
      ws.terminate()
    })
  })

  // Server-side liveness: ping every interval, and drop a socket that has
  // missed two pongs in a row.
  const sweep = setInterval(() => {
    for (const ws of wss.clients) {
      const missed = missedPongs.get(ws) ?? 0
      if (missed >= 2) {
        ws.terminate()
        continue
      }
      missedPongs.set(ws, missed + 1)
      ws.ping()
    }
  }, config.wsPingIntervalMs)

  wss.on('close', () => clearInterval(sweep))

  return {
    wss,
    loseAll() {
      for (const registry of [...registries]) registry.loseAll()
      for (const ws of wss.clients) ws.close(1012, 'Service restart')
    },
    connectionCounts() {
      return new Map(perIp)
    },
    async close() {
      clearInterval(sweep)
      for (const ws of wss.clients) ws.terminate()
      await new Promise<void>(resolve => wss.close(() => resolve()))
    }
  }
}
