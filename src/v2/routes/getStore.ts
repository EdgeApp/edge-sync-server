import {
  asGetStoreParams,
  GetStoreParams,
  GetStoreResponse
} from 'edge-sync-client'
import { Router } from 'express'
import PromiseRouter from 'express-promise-router'

import { AppState } from '../../server'
import { wasCheckpointArray } from '../../types/checkpoints'
import { migrateRepo } from '../../util/migration'
import { syncKeyToRepoId } from '../../util/security'
import { ServerError } from '../../util/server-error'
import {
  checkpointRollbackLogging,
  getCheckpointsFromHash
} from '../../util/store/checkpoints'
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

    // Deprecate after migrations
    if (!(await checkRepoExists(appState)(repoId))) {
      try {
        await migrateRepo(appState)(syncKey)
      } catch (error) {
        if (error.message === 'Repo not found') {
          throw new ServerError(404, `Repo not found`)
        }
        throw error
      }
    }

    await resolveAllDocumentConflicts(appState)(repoId)

    const clientCheckpoints = getCheckpointsFromHash(params.hash)

    const repoUpdates = await readUpdates(appState)(repoId, clientCheckpoints)

    const hash = wasCheckpointArray(repoUpdates.checkpoints) as string

    // Log rollbacks
    checkpointRollbackLogging(req.id, repoId, params.hash, hash)

    // Response
    const responseData: GetStoreResponse = {
      hash,
      changes: repoUpdates.changeSet
    }

    res.status(201).json(responseData)
  })

  return router
}
