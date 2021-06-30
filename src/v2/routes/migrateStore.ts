import { Router } from 'express'
import PromiseRouter from 'express-promise-router'

import { AppState } from '../../server'
import { migrateRepo } from '../../util/migration'
import { syncKeyToRepoId } from '../../util/security'
import { checkRepoExists } from '../../util/store/repo'
import { makeApiClientError } from '../../util/utils'
import { asGetStoreParams, GetStoreParams } from '../types'

export const getMigrateStoreRouter = (appState: AppState): Router => {
  const router = PromiseRouter()

  router.get('/migrate/:syncKey?', async (req, res) => {
    let params: GetStoreParams

    // Request body validation
    try {
      params = asGetStoreParams(req.params)
    } catch (error) {
      throw makeApiClientError(400, error.message)
    }

    const { syncKey } = params
    const repoId = syncKeyToRepoId(syncKey)

    // Deprecate after migrations
    if (!(await checkRepoExists(appState)(repoId))) {
      try {
        await migrateRepo(appState)(syncKey)
      } catch (error) {
        if (error.message === 'Repo not found') {
          throw makeApiClientError(404, `Repo not found`)
        }
        throw error
      }
    }

    // Response:

    res.status(201).json({ done: true })
  })

  return router
}
