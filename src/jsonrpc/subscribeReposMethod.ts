import { JsonRpcStream } from '../lib/callet'
import { AppJsonRpcRequest } from './allMethods'
import { invalidParams, rateLimited } from './jsonRpcErrors'

const RATE_WINDOW_MS = 60 * 1000

/**
 * `subscribeRepos(Array<[repoId, checkpoint?]>) → Array<SubscribeResult>`
 *
 * Notify-only: the result says whether each repo differs from the client's
 * newest checkpoint, and later `update` notifications carry the server's
 * new checkpoint. Changes are always pulled over REST.
 *
 * Results are parallel to the params. Entries past the connection's
 * subscription cap answer 0 instead of failing the call, so a client with
 * more repos opens another socket.
 */
export async function* subscribeReposMethod(
  request: AppJsonRpcRequest
): JsonRpcStream {
  const { params, connection } = request
  const { limits, registry } = connection

  if (
    !Array.isArray(params) ||
    params.length > limits.maxReposPerSubscribe ||
    !params.every(
      entry => Array.isArray(entry) && entry.length >= 1 && entry.length <= 2
    )
  ) {
    yield invalidParams(
      request,
      `Expected at most ${limits.maxReposPerSubscribe} [repoId, checkpoint?] entries`
    )
    return
  }

  const now = Date.now()
  connection.subscribeCalls = connection.subscribeCalls.filter(
    time => now - time < RATE_WINDOW_MS
  )
  if (connection.subscribeCalls.length >= limits.subscribeCallsPerMinute) {
    yield rateLimited(request)
    return
  }
  connection.subscribeCalls.push(now)

  try {
    const results = await registry.subscribe(
      params as Array<[unknown, unknown?]>
    )
    yield { id: request.id, result: results }
  } finally {
    // Updates that raced this call go out after its response, never before.
    registry.flushQueued()
  }
}
