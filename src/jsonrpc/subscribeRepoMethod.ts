import {
  asGetStoreParams,
  asGetStoreResponse,
  GetStoreResponse
} from 'edge-sync-client'
import { HttpResponse } from 'serverlet'

import { JsonRpcId, JsonRpcStream } from '../lib/callet'
import { syncKeyToRepoId } from '../util/security'
import { AppJsonRpcMethod } from './allMethods'

export const subscribeRepoMethod: AppJsonRpcMethod = async function* (request) {
  const { connectionInfo, couchDbChangeStream, subscriptions } = request
  const { syncKey, hash } = asGetStoreParams(request.params)
  const repoId = syncKeyToRepoId(syncKey)

  const subscription = {
    hash
  }
  const subscriptionId = `subscribeAddress:${syncKey}`
  subscriptions.set(subscriptionId, subscription)

  // Query immediately on new subscription:
  const response = await queryForChangeset()
  yield* handleHttpResponse(request.id, response)

  for await (const changes of couchDbChangeStream) {
    if (
      !connectionInfo.isConnected ||
      subscriptions.get(subscriptionId) !== subscription
    )
      break

    if (changes.id.slice(0, changes.id.indexOf(':')) === repoId) {
      const response = await queryForChangeset()
      yield* handleHttpResponse(null, response)
    }
  }

  // Cleanup subscription connection
  subscriptions.delete(subscriptionId)

  async function queryForChangeset(): Promise<HttpResponse> {
    return await request.httpApp({
      headers: {},
      method: 'GET',
      path: `/store/${syncKey}/${subscription.hash ?? ''}`,
      version: '1.1'
    })
  }

  async function* handleHttpResponse(
    id: JsonRpcId,
    response: HttpResponse
  ): JsonRpcStream {
    const { body = '{}', status = 500 } = response

    // Error response:
    if (status < 200 || status >= 300) {
      const data = body
      yield {
        id,
        error: {
          code: status,
          message: `Error: ${status}`,
          data
        }
      }
      return
    }

    // Successful response:
    // Parse the expected response body
    const json = JSON.parse(typeof body === 'string' ? body : body.toString())
    const result: GetStoreResponse = asGetStoreResponse(json)

    // Update subscription hash state
    subscription.hash = result.hash

    // Yield the JSON-RPC response:
    if (id != null) {
      yield {
        id,
        result: { success: true }
      }
    }

    // Yield the subscription message:
    yield {
      id: null,
      method: 'subscribeRepo',
      params: result
    }
  }
}
