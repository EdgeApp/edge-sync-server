import { Router } from 'express'
import PromiseRouter from 'express-promise-router'

import { checkRepoExists, createRepoDocument } from '../../api/repo'
import { AppState } from '../../server'
import { asTimestampRev } from '../../types/old-types'
import { syncKeyToRepoId } from '../../util/security'
import { makeApiClientError } from '../../util/utils'
import { whitelistIps } from '../../whitelisting'
import { asPutStoreParams, PutStoreParams, PutStoreResponse } from '../types'

export const putStoreRouter = (appState: AppState): Router => {
  const router = PromiseRouter()

  router.put('/store/:syncKey', whitelistIps(appState), async (req, res) => {
    let params: PutStoreParams

    // Request body validation
    try {
      params = asPutStoreParams(req.params)
    } catch (error) {
      throw makeApiClientError(400, error.message)
    }

    const { syncKey } = params
    const repoId = syncKeyToRepoId(syncKey)

    if (await checkRepoExists(appState)(repoId)) {
      throw makeApiClientError(409, 'Datastore already exists')
    }

    // Create new repo
    const timestamp = asTimestampRev(Date.now())

    await createRepoDocument(appState)(repoId, {
      timestamp
    })

    // Response:

    const responseData: PutStoreResponse = undefined
    res.status(201).json(responseData)
  })

  return router
}
