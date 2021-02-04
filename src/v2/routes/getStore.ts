import { Router } from 'express'
import PromiseRouter from 'express-promise-router'

import { getRepoUpdates } from '../../api/getUpdates'
import { migrateRepo } from '../../api/migrations'
import { checkRepoExists } from '../../api/repo'
import { AppState } from '../../server'
import { makeApiClientError } from '../../util/utils'
import {
  asGetStoreParams,
  ChangeSetV2,
  GetStoreParams,
  GetStoreResponse
} from '../types'
import {
  getChangesFromRepoUpdates,
  getTimestampRevFromHashParam
} from '../utils'

export const getStoreRouter = (appState: AppState): Router => {
  const router = PromiseRouter()

  router.get('/store/:storeId/:hash?', async (req, res) => {
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

    const clientTimestamp = await getTimestampRevFromHashParam(appState)(
      repoId,
      params.hash
    )
    const repoChanges = await getRepoUpdates(appState)(repoId, clientTimestamp)

    const changes: ChangeSetV2 = await getChangesFromRepoUpdates(appState)(
      repoId,
      repoChanges
    )

    const responseData: GetStoreResponse = {
      hash: repoChanges.timestamp.toString(),
      changes
    }

    // Response:

    res.status(201).json(responseData)
  })

  return router
}
