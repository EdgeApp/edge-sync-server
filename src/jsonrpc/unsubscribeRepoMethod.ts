import { asGetStoreParams } from 'edge-sync-client'

import { AppJsonRpcMethod } from './allMethods'

export const unsubscribeRepoMethod: AppJsonRpcMethod = async function* (
  request
) {
  const { id, subscriptions } = request
  const { syncKey } = asGetStoreParams(request.params)

  const subscriptionId = `subscribeAddress:${syncKey}`
  subscriptions.delete(subscriptionId)

  if (id != null) yield { id, result: { success: true } }
}
