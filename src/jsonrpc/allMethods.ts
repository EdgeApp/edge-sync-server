import { WsJsonRpcMessage } from '../adapters/makeWsConnection'
import { Callet } from '../lib/callet'
import { withJsonRpcMethod } from '../middleware/withJsonRpcMethod'
import { pingMethod } from './pingMethod'
import { subscribeReposMethod } from './subscribeReposMethod'
import { unsubscribeReposMethod } from './unsubscribeReposMethod'

/** The app's JSON-RPC request type additions */
export type AppJsonRpcRequest = WsJsonRpcMessage

/** The app's JSON-RPC over WebSocket method nodelet type */
export type AppJsonRpcMethod = Callet<AppJsonRpcRequest>

/** The JSON-RPC method table. */
export const allJsonRpcMethods = withJsonRpcMethod<AppJsonRpcRequest>({
  ping: pingMethod,
  subscribeRepos: subscribeReposMethod,
  unsubscribeRepos: unsubscribeReposMethod
})
