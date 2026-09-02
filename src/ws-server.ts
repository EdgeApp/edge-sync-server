import { Server } from 'http'
import WebSocket from 'ws'

import { makeWsConnection } from './adapters/makeWsConnection'
import { allJsonRpcMethods } from './jsonrpc/allMethods'

export function makeWsServer(server: Server): WebSocket.Server {
  const wss = new WebSocket.Server({
    server
  })
  wss.on('connection', function connection(ws) {
    makeWsConnection(ws, allJsonRpcMethods)
  })

  return wss
}
