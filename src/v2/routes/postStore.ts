import {
  asPath,
  asPostStoreBody,
  asPostStoreParams,
  PostStoreBody,
  PostStoreParams,
  PostStoreResponse
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
import { readUpdates, writeUpdates } from '../../util/store/syncing'

export const postStoreRouter = (appState: AppState): Router => {
  const router = PromiseRouter()

  router.post('/store/:syncKey/:hash?', async (req, res) => {
    let body: PostStoreBody
    let params: PostStoreParams

    // Validate request
    try {
      params = asPostStoreParams(req.params)
      body = asPostStoreBody(req.body)

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
    logCheckpointRollback(req.log, req.id, repoId, params.hash, hash)

    // Log change summary
    logChangeSummary(req.log, body.changes)

    // Response
    const responseData: PostStoreResponse = {
      hash,
      changes: repoUpdates.changeSet
    }
    res.status(200).json(responseData)
  })

  return router
}
