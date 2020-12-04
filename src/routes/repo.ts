import { asNumber, asObject, asOptional, asString } from 'cleaners'
import Router from 'express-promise-router'

import { checkRepoExists, createRepoDocument } from '../api/repo'
import { asNonEmptyString } from '../types'
import { makeApiClientError, makeApiResponse } from '../utils'

type PutRepoBody = ReturnType<typeof asPutRepoBody>

interface RepoPutResponseData {
  timestamp: number
}

const asPutRepoBody = asObject({
  repoId: asNonEmptyString,
  lastGitHash: asOptional(asString),
  lastGitTime: asOptional(asNumber)
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

  const repoKey: string = `${body.repoId}:/`

  if (await checkRepoExists(repoKey)) {
    throw makeApiClientError(409, 'Datastore already exists')
  }

  // Create new repo
  const timestamp = Date.now()

  await createRepoDocument(repoKey, {
    timestamp,
    lastGitHash: body.lastGitHash,
    lastGitTime: body.lastGitTime
  })

  // Send response
  res.status(201).json(
    makeApiResponse<RepoPutResponseData>({ timestamp })
  )
})
