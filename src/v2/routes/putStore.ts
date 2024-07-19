import {
  asPutStoreParams,
  PutStoreParams,
  PutStoreResponse
} from 'edge-sync-client'
import { Router } from 'express'
import PromiseRouter from 'express-promise-router'

import { AppState } from '../../server'
import { syncKeyToRepoId } from '../../util/security'
import { ServerError } from '../../util/server-error'
import { checkRepoExists, createRepoDocument } from '../../util/store/repo'
import { whitelistApiKeys, whitelistIps } from '../../whitelisting'

export const putStoreRouter = (appState: AppState): Router => {
  const router = PromiseRouter()

  router.put(
    '/store/:syncKey',
    whitelistIps(appState),
    whitelistApiKeys(appState),
    async (req, res) => {
      let params: PutStoreParams

      // Request body validation
      try {
        params = asPutStoreParams(req.params)
      } catch (error) {
        throw new ServerError(400, error.message)
      }

      const repoId = syncKeyToRepoId(params.syncKey)

      if (await checkRepoExists(appState)(repoId)) {
        throw new ServerError(409, 'Datastore already exists')
      }

      // Create new repo
      const timestamp = Date.now()

      await createRepoDocument(appState)(repoId, {
        timestamp
      })

      // Response:

      const responseData: PutStoreResponse = undefined
      res.status(201).json(responseData)
    }
  )

  return router
}
