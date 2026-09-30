import { JsonRpcStream } from '../lib/callet'
import { AppJsonRpcRequest } from './allMethods'

/** Application-level keepalive, so a client can detect a half-open socket. */
export async function* pingMethod(request: AppJsonRpcRequest): JsonRpcStream {
  yield { id: request.id, result: 'pong' }
}
