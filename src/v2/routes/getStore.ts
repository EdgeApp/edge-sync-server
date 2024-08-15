import {
  asGetStoreParams,
  GetStoreParams,
  GetStoreResponse
} from 'edge-sync-client'

import { wasCheckpointArray } from '../../types/checkpoints'
import { logChangeSummary, logCheckpointRollback } from '../../util/logging'
import { syncKeyToRepoId } from '../../util/security'
import { ServerError } from '../../util/server-error'
import { getCheckpointsFromHash } from '../../util/store/checkpoints'
import { resolveAllDocumentConflicts } from '../../util/store/conflict-resolution'
import { checkRepoExists } from '../../util/store/repo'
import { readUpdates } from '../../util/store/syncing'
import { AppRoute } from './router'

export const getStoreRoute: AppRoute = async request => {
  const { appState } = request

  let params: GetStoreParams

  // Request body validation
  try {
    params = asGetStoreParams(request.params)
  } catch (error) {
    throw new ServerError(400, error.message)
  }

  const repoId = syncKeyToRepoId(params.syncKey)

  // Check if repo document exists
  if (!(await checkRepoExists(appState)(repoId))) {
    throw new ServerError(404, `Repo not found`)
  }

  await resolveAllDocumentConflicts(appState)(repoId)

  const clientCheckpoints = getCheckpointsFromHash(params.hash)

  const repoUpdates = await readUpdates(appState)(repoId, clientCheckpoints)

  const hash = wasCheckpointArray(repoUpdates.checkpoints) as string

  // Log rollbacks
  logCheckpointRollback(request.log, request.id, repoId, params.hash, hash)

  // Log change summary
  logChangeSummary(request.log, repoUpdates.changeSet)

  // Response
  const responseData: GetStoreResponse = {
    hash,
    changes: repoUpdates.changeSet
  }

  return {
    status: 201,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(responseData)
  }
}
