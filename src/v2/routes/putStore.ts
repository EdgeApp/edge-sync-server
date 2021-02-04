import { Router } from 'express'
import PromiseRouter from 'express-promise-router'

import { checkRepoExists, createRepoDocument } from '../../api/repo'
import { AppState } from '../../server'
import { asTimestampRev } from '../../types'
import { makeApiClientError, makeApiResponse } from '../../util/utils'
import { whitelistIps } from '../../whitelisting'
import { asPutStoreParams, PutStoreParams, PutStoreResponse } from '../types'

export const putStoreRouter = (appState: AppState): Router => {
  const router = PromiseRouter()

  router.put('/store/:storeId', whitelistIps(appState), async (req, res) => {
    let params: PutStoreParams

    // Request body validation
    try {
      params = asPutStoreParams(req.params)
    } catch (error) {
      throw makeApiClientError(400, error.message)
    }

    if (await checkRepoExists(appState)(params.storeId)) {
      throw makeApiClientError(409, 'Datastore already exists')
    }

    // Create new repo
    const timestamp = asTimestampRev(Date.now())

    await createRepoDocument(appState)(params.storeId, {
      timestamp
    })

    // Send response
    res.status(201).json(
      makeApiResponse<PutStoreResponse>({ timestamp })
    )
  })

  return router
}
