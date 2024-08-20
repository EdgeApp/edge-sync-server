import { asMaybe, asString } from 'cleaners'
import WebSocket from 'ws'

import {
  asJsonRpcMessage,
  Callet,
  JsonRpcMessage,
  wasJsonRpcMessage
} from '../lib/callet'
import { logger } from '../logger'

export type WsJsonRpcMessage = JsonRpcMessage & {
  connectionInfo: {
    isConnected: boolean
  }
}

export const makeWsConnection = (
  ws: WebSocket,
  server: Callet<WsJsonRpcMessage>
): void => {
  const connectionInfo: WsJsonRpcMessage['connectionInfo'] = {
    isConnected: true
  }

  ws.on('close', function open() {
    connectionInfo.isConnected = false
  })

  ws.on('error', err => {
    logger.error({ err })
  })

  ws.on('message', function message(data) {
    if (!Buffer.isBuffer(data)) return

    const dataString = data.toString()
    const message = asMaybe(asJsonRpcMessage)(dataString)

    if (message == null) {
      logger.warn({
        msg: 'Received invalid ws request message'
        // TODO: Log the dataString once sanitization of any syncKey is implemented
        // dataString
      })
      return
    }

    processWsRequestMessage(message).catch(err => {
      logger.error({ msg: 'Error processing ws request message', err })
    })
  })

  async function processWsRequestMessage(
    message: JsonRpcMessage
  ): Promise<void> {
    const request: WsJsonRpcMessage = {
      ...message,
      connectionInfo
    }

    const generator = await server(request)

    for await (const response of generator) {
      const message = asString(wasJsonRpcMessage(response))
      ws.send(message)
    }
  }
}
