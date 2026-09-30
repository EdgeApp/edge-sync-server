import { asMaybe, asString } from 'cleaners'
import WebSocket from 'ws'

import { SubscriptionRegistry } from '../engine/subscriptionRegistry'
import {
  asJsonRpcMessage,
  Callet,
  JsonRpcMessage,
  wasJsonRpcMessage
} from '../lib/callet'
import { logger } from '../logger'

/** Limits a connection enforces on its own calls. */
export interface WsConnectionLimits {
  maxReposPerSubscribe: number
  subscribeCallsPerMinute: number
}

/** Everything a JSON-RPC method needs to know about its socket. */
export interface WsConnection {
  isConnected: boolean
  registry: SubscriptionRegistry
  limits: WsConnectionLimits
  /** Start times of recent `subscribeRepos` calls, for the rate limit. */
  subscribeCalls: number[]
}

export type WsJsonRpcMessage = JsonRpcMessage & {
  connection: WsConnection
}

/** Sends a JSON-RPC 2.0 notification, which has a method and no id. */
export const sendWsNotification = (
  ws: WebSocket,
  method: string,
  params: unknown
): void => {
  if (ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ jsonrpc: '2.0', method, params }))
}

/**
 * The error for a frame that is not a valid request: -32700 if it is not
 * JSON, otherwise -32600, echoing its id when it has a usable one so the
 * caller can match the error to its call.
 */
const invalidFrameResponse = (text: string): JsonRpcMessage => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { id: null, error: { code: -32700, message: 'Parse error' } }
  }
  const rawId =
    typeof parsed === 'object' && parsed != null
      ? (parsed as { id?: unknown }).id
      : undefined
  const id =
    typeof rawId === 'string' || typeof rawId === 'number' ? rawId : null
  return { id, error: { code: -32600, message: 'Invalid Request' } }
}

export const makeWsConnection = (
  ws: WebSocket,
  server: Callet<WsJsonRpcMessage>,
  connection: WsConnection
): void => {
  const send = (message: JsonRpcMessage): void => {
    if (ws.readyState !== WebSocket.OPEN) return
    ws.send(asString(wasJsonRpcMessage(message)))
  }

  ws.on('message', function message(data: WebSocket.RawData) {
    const dataString = Array.isArray(data)
      ? Buffer.concat(data).toString()
      : Buffer.from(data as ArrayBuffer).toString()
    const message = asMaybe(asJsonRpcMessage)(dataString)

    if (message == null) {
      // The frame is untrusted, so only its size is logged.
      logger.warn({
        msg: 'Received invalid ws request message',
        bytes: dataString.length
      })
      send(invalidFrameResponse(dataString))
      return
    }

    processWsRequestMessage(message).catch(err => {
      logger.error({ msg: 'Error processing ws request message', err })
    })
  })

  async function processWsRequestMessage(
    message: JsonRpcMessage
  ): Promise<void> {
    const request: WsJsonRpcMessage = { ...message, connection }

    const generator = await server(request)

    for await (const response of generator) {
      send(response)
    }
  }
}
