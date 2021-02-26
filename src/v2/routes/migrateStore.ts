import { Router } from 'express'
import PromiseRouter from 'express-promise-router'

import { migrateRepo } from '../../api/migrations'
import { checkRepoExists } from '../../api/repo'
import { AppState } from '../../server'
import { makeApiClientError } from '../../util/utils'
import { asGetStoreParams, GetStoreParams } from '../types'

export const getMigrateStoreRouter = (appState: AppState): Router => {
  const router = PromiseRouter()

  router.get('/migrate/:storeId?', async (req, res) => {
    let params: GetStoreParams

    // Request body validation
    try {
      params = asGetStoreParams(req.params)
    } catch (error) {
      throw makeApiClientError(400, error.message)
    }

    const repoId = params.storeId

    // Deprecate after migrations
    if (!(await checkRepoExists(appState)(repoId))) {
      try {
        await migrateRepo(appState)(repoId)
      } catch (error) {
        if (error.message === 'Repo not found') {
          throw makeApiClientError(404, `Repo '${repoId}' not found`)
        }
        throw error
      }
    }

    // Response:

    res.status(201).json({ done: true })
  })

  return router
}
