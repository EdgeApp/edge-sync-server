import {
  asPath,
  asPostStoreBody,
  asPostStoreParams,
  PostStoreBody,
  PostStoreParams,
  PostStoreResponse
} from 'edge-sync-client'

import { wasCheckpointArray } from '../../types/checkpoints'
import { logChangeSummary, logCheckpointRollback } from '../../util/logging'
import { syncKeyToRepoId } from '../../util/security'
import { ServerError } from '../../util/server-error'
import { getCheckpointsFromHash } from '../../util/store/checkpoints'
import { resolveAllDocumentConflicts } from '../../util/store/conflict-resolution'
import { checkRepoExists } from '../../util/store/repo'
import { readUpdates, writeUpdates } from '../../util/store/syncing'
import { AppRoute } from './router'

export const postStoreRoute: AppRoute = async request => {
  const { appState } = request

  let body: PostStoreBody
  let params: PostStoreParams

  // Validate request
  try {
    params = asPostStoreParams(request.params)
    body = asPostStoreBody(request.body)

    // Validate paths
    Object.keys(body.changes).map(path => asPath(path))
  } catch (error) {
    throw new ServerError(400, error.message)
  }

  const repoId = syncKeyToRepoId(params.syncKey)
  const clientCheckpoints = getCheckpointsFromHash(params.hash)

  // Check if repo document exists
  if (!(await checkRepoExists(appState)(repoId))) {
    throw new ServerError(404, `Repo not found`)
  }

  await resolveAllDocumentConflicts(appState)(repoId)

  // Update documents using changes
  await writeUpdates(appState)(repoId, body.changes)

  // Get updates using the client timestamp from request body
  const repoUpdates = await readUpdates(appState)(repoId, clientCheckpoints)

  const hash = wasCheckpointArray(repoUpdates.checkpoints) as string

  // Log rollbacks
  logCheckpointRollback(request.log, request.id, repoId, params.hash, hash)

  // Log change summary
  logChangeSummary(request.log, body.changes)

  // Response
  const responseData: PostStoreResponse = {
    hash,
    changes: repoUpdates.changeSet
  }

  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(responseData)
  }
}
