import { Router } from 'express'
import PromiseRouter from 'express-promise-router'

import { AppState } from '../../server'
import { wasCheckpointArray } from '../../types/checkpoints'
import { ServerError } from '../../types/primitive-types'
import { migrateRepo } from '../../util/migration'
import { syncKeyToRepoId } from '../../util/security'
import { getCheckpointsFromHash } from '../../util/store/checkpoints'
import { resolveAllDocumentConflicts } from '../../util/store/conflict-resolution'
import { checkRepoExists } from '../../util/store/repo'
import { readUpdates } from '../../util/store/syncing'
import { asGetStoreParams, GetStoreParams, GetStoreResponse } from '../types'

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

    const responseData: GetStoreResponse = {
      hash,
      changes: repoUpdates.changeSet
    }

    // Response:

    res.status(201).json(responseData)
  })

  return router
}
