import { Server } from 'http'
import WebSocket from 'ws'

import { makeWsConnection, WsJsonRpcMessage } from './adapters/makeWsConnection'
import { makeCouchDbChangeStream } from './db/CouchDbChangeStream'
import { allJsonRpcMethods } from './jsonrpc/allMethods'
import { Callet, JsonRpcStream } from './lib/callet'
import { logger } from './logger'
import { withAppState } from './middleware/withAppState'
import { withPino } from './middleware/withPino'
import { AppState } from './server'
import { allRoutes } from './v2/routes/router'

export function makeWsServer(
  server: Server,
  appState: AppState
): WebSocket.Server {
  // WebSocket server state:
  const subscriptions = new Map<string, unknown>()

  // HTTP serverlet app:
  const routesWithLogger = withPino(logger, allRoutes)
  const httpApp = withAppState(appState, routesWithLogger)

  const couchDbChangeStream = makeCouchDbChangeStream(appState)

  // JSON-RPC WebSocket serverlet app:
  const jsonRpcApp: Callet<WsJsonRpcMessage, JsonRpcStream> = message =>
    allJsonRpcMethods({
      ...message,
      couchDbChangeStream,
      httpApp,
      subscriptions
    })

  // WebSocket server:
  const wss = new WebSocket.Server({
    server
  })
  wss.on('connection', function connection(ws) {
    makeWsConnection(ws, jsonRpcApp)
  })

  return wss
}
