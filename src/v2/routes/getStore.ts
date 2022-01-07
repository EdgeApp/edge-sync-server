import {
  asGetStoreParams,
  GetStoreParams,
  GetStoreResponse
} from 'edge-sync-client'
import { Router } from 'express'
import PromiseRouter from 'express-promise-router'

import { AppState } from '../../server'
import { wasCheckpointArray } from '../../types/checkpoints'
import { logChangeSummary, logCheckpointRollback } from '../../util/logging'
import { syncKeyToRepoId } from '../../util/security'
import { ServerError } from '../../util/server-error'
import { getCheckpointsFromHash } from '../../util/store/checkpoints'
import { resolveAllDocumentConflicts } from '../../util/store/conflict-resolution'
import { checkRepoExists } from '../../util/store/repo'
import { readUpdates } from '../../util/store/syncing'

export const getStoreRouter = (appState: AppState): Router => {
  const router = PromiseRouter()

  router.get('/store/:syncKey/:hash?', async (req, res) => {
    let params: GetStoreParams

    // Request body validation
    try {
      params = asGetStoreParams(req.params)
    } catch (error) {
      throw new ServerError(400, error.message)
    }

    const { syncKey } = params
    const repoId = syncKeyToRepoId(syncKey)

    // Check if repo document exists
    if (!(await checkRepoExists(appState)(repoId))) {
      throw new ServerError(404, `Repo not found`)
    }

    await resolveAllDocumentConflicts(appState)(repoId)

    const clientCheckpoints = getCheckpointsFromHash(params.hash)

    const repoUpdates = await readUpdates(appState)(repoId, clientCheckpoints)

    const hash = wasCheckpointArray(repoUpdates.checkpoints) as string

    // Log rollbacks
    logCheckpointRollback(req.log, req.id, repoId, params.hash, hash)

    // Log change summary
    logChangeSummary(req.log, repoUpdates.changeSet)

    // Response
    const responseData: GetStoreResponse = {
      hash,
      changes: repoUpdates.changeSet
    }

    res.status(201).json(responseData)
  })

  return router
}
