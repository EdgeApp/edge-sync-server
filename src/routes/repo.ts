import { asObject } from 'cleaners'
import Router from 'express-promise-router'

import { checkRepoExists, createRepoDocument } from '../api/repo'
import { asNonEmptyString } from '../types'
import { makeApiClientError, makeApiResponse } from '../utils'

type PutRepoBody = ReturnType<typeof asPutRepoBody>

interface RepoPutResponseData {
  timestamp: number
}

const asPutRepoBody = asObject({
  repoId: asNonEmptyString
})

export const repoRouter = Router()

repoRouter.put('/repo', async (req, res) => {
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
