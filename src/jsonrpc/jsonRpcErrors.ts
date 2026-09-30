import { JsonRpcMessage } from '../lib/callet'

export const invalidParams = (
  request: JsonRpcMessage,
  message: string
): JsonRpcMessage => ({
  id: request.id,
  error: { code: -32602, message: `Invalid params: ${message}` }
})

export const rateLimited = (request: JsonRpcMessage): JsonRpcMessage => ({
  id: request.id,
  error: { code: -32000, message: 'Too many subscribe calls' }
})
