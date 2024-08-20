import { DatabaseChangesResultItem } from 'nano'
import { Serverlet } from 'serverlet'

import { ExpressRequest } from '../adapters/makeExpressMiddleware'
import { WsJsonRpcMessage } from '../adapters/makeWsConnection'
import { Callet, JsonRpcMessage } from '../lib/callet'
import { withJsonRpcMethod } from '../middleware/withJsonRpcMethod'
import { subscribeRepoMethod } from './subscribeRepoMethod'
import { unsubscribeRepoMethod } from './unsubscribeRepoMethod'

/** The app's JSON-RPC request type additions */
export interface AppJsonRpcRequest extends JsonRpcMessage, WsJsonRpcMessage {
  couchDbChangeStream: AsyncGenerator<DatabaseChangesResultItem>
  httpApp: Serverlet<ExpressRequest>
  subscriptions: Map<string, unknown>
}

/** The app's JSON-RPC over WebSocket method nodelet type */
export type AppJsonRpcMethod = Callet<AppJsonRpcRequest>

export const allJsonRpcMethods = withJsonRpcMethod({
  subscribeRepo: subscribeRepoMethod,
  unsubscribeRepo: unsubscribeRepoMethod
})
