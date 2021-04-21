import { Router } from 'express'
import PromiseRouter from 'express-promise-router'

import { checkRepoExists, createRepoDocument } from '../api/repo'
import { AppState } from '../server'
import {
  asPutRepoBody,
  asTimestampRev,
  PutRepoBody,
  PutRepoResponse
} from '../types'
import { syncKeyToRepoId } from '../util/security'
import { makeApiClientError, makeApiResponse } from '../util/utils'
import { whitelistAll } from '../whitelisting'

export const repoRouter = (appState: AppState): Router => {
  const router = PromiseRouter()

  router.put('/repo', whitelistAll(appState), async (req, res) => {
    let body: PutRepoBody

    // Request body validation
    try {
      body = asPutRepoBody(req.body)
    } catch (error) {
      throw makeApiClientError(400, error.message)
    }

    const { syncKey } = body
    const repoId = syncKeyToRepoId(syncKey)

    if (await checkRepoExists(appState)(repoId)) {
      throw makeApiClientError(409, 'Datastore already exists')
    }

    // Create new repo
    const timestamp = asTimestampRev(Date.now())

    await createRepoDocument(appState)(repoId, {
      timestamp
    })

    // Send response
    res.status(201).json(
      makeApiResponse<PutRepoResponse>({ timestamp })
    )
  })

  return router
}
