import { Router } from 'express'
import PromiseRouter from 'express-promise-router'

import { AppState } from '../../server'
import { wasCheckpointArray } from '../../types/checkpoints'
import { asPath, ServerError } from '../../types/primitive-types'
import { migrateRepo } from '../../util/migration'
import { syncKeyToRepoId } from '../../util/security'
import {
  checkpointRollbackLogging,
  getCheckpointsFromHash
} from '../../util/store/checkpoints'
import { resolveAllDocumentConflicts } from '../../util/store/conflict-resolution'
import { checkRepoExists } from '../../util/store/repo'
import { readUpdates, writeUpdates } from '../../util/store/syncing'
import {
  asPostStoreBody,
  asPostStoreParams,
  PostStoreBody,
  PostStoreParams,
  PostStoreResponse
} from '../types'

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

    const { syncKey } = params
    const repoId = syncKeyToRepoId(syncKey)
    const clientCheckpoints = getCheckpointsFromHash(params.hash)

    // Check if repo document exists
    if (!(await checkRepoExists(appState)(repoId))) {
      try {
        // Deprecate after migrations
        await migrateRepo(appState)(syncKey)
      } catch (error) {
        if (error.message === 'Repo not found') {
          throw new ServerError(404, `Repo not found`)
        }
        throw error
      }
    }

    await resolveAllDocumentConflicts(appState)(repoId)

    // Update documents using changes
    await writeUpdates(appState)(repoId, body.changes)

    // Get updates using the client timestamp from request body
    const repoUpdates = await readUpdates(appState)(repoId, clientCheckpoints)

    const hash = wasCheckpointArray(repoUpdates.checkpoints) as string

    // Log rollbacks
    checkpointRollbackLogging(req.id, repoId, params.hash, hash)

    // Response
    const responseData: PostStoreResponse = {
      hash,
      changes: repoUpdates.changeSet
    }
    res.status(200).json(responseData)
  })

  return router
}
