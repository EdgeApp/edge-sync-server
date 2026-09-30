import { JsonRpcStream } from '../lib/callet'
import { AppJsonRpcRequest } from './allMethods'
import { invalidParams } from './jsonRpcErrors'

/**
 * `unsubscribeRepos(Array<[repoId]>) → undefined`
 *
 * Repos this socket does not hold are ignored.
 */
export async function* unsubscribeReposMethod(
  request: AppJsonRpcRequest
): JsonRpcStream {
  const { params, connection } = request
  if (
    !Array.isArray(params) ||
    params.length > connection.limits.maxReposPerSubscribe ||
    !params.every(entry => Array.isArray(entry) && entry.length === 1)
  ) {
    yield invalidParams(
      request,
      `Expected at most ${connection.limits.maxReposPerSubscribe} [repoId] entries`
    )
    return
  }

  connection.registry.unsubscribe(params.map(([repoId]) => repoId))
  yield { id: request.id, result: undefined }
}
