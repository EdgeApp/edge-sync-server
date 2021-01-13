import { asObject } from 'cleaners'
import { Router } from 'express'
import PromiseRouter from 'express-promise-router'

import { checkRepoExists, createRepoDocument } from '../api/repo'
import { AppState } from '../server'
import { asRepoId, asTimestampRev, TimestampRev } from '../types'
import { makeApiClientError, makeApiResponse } from '../util/utils'
import { whitelistAll } from '../whitelisting'

type PutRepoBody = ReturnType<typeof asPutRepoBody>
const asPutRepoBody = asObject({
  repoId: asRepoId
})

interface RepoPutResponseData {
  timestamp: TimestampRev
}

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

    if (await checkRepoExists(appState)(body.repoId)) {
      throw makeApiClientError(409, 'Datastore already exists')
    }

    // Create new repo
    const timestamp = asTimestampRev(Date.now())

    await createRepoDocument(appState)(body.repoId, {
      timestamp
    })

    // Send response
    res.status(201).json(
      makeApiResponse<RepoPutResponseData>({ timestamp })
    )
  })

  return router
}
