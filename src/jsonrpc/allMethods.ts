import { WsJsonRpcMessage } from '../adapters/makeWsConnection'
import { Callet } from '../lib/callet'
import { withJsonRpcMethod } from '../middleware/withJsonRpcMethod'

/** The app's JSON-RPC request type additions */
export type AppJsonRpcRequest = WsJsonRpcMessage

/** The app's JSON-RPC over WebSocket method nodelet type */
export type AppJsonRpcMethod = Callet<AppJsonRpcRequest>

/**
 * The JSON-RPC method table. No methods are registered yet; the repo
 * subscription methods land with the change engine, so every call currently
 * falls through to the "Method not found" fallback.
 */
export const allJsonRpcMethods = withJsonRpcMethod<AppJsonRpcRequest>({})
