import { asObject } from 'cleaners'
import Router from 'express-promise-router'

import { checkRepoExists, createRepoDocument } from '../api/repo'
import { asRepoId } from '../types'
import { makeApiClientError, makeApiResponse } from '../util/utils'
import { whitelistAll } from '../whitelisting'

type PutRepoBody = ReturnType<typeof asPutRepoBody>
const asPutRepoBody = asObject({
  repoId: asRepoId
})

interface RepoPutResponseData {
  timestamp: number
}

export const repoRouter = Router()

repoRouter.put('/repo', whitelistAll, async (req, res) => {
  let body: PutRepoBody

  // Request body validation
  try {
    body = asPutRepoBody(req.body)
  } catch (error) {
    throw makeApiClientError(400, error.message)
  }

  if (await checkRepoExists(body.repoId)) {
    throw makeApiClientError(409, 'Datastore already exists')
  }

  // Create new repo
  const timestamp = Date.now()

  await createRepoDocument(body.repoId, {
    timestamp
  })

  // Send response
  res.status(201).json(
    makeApiResponse<RepoPutResponseData>({ timestamp })
  )
})
