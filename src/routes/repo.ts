import { asNumber, asObject, asOptional, asString } from 'cleaners'
import Router from 'express-promise-router'

import { dataStore } from '../db'
import { ApiErrorResponse, ApiResponse, StoreRepoDocument } from '../types'

type PutRepoBody = ReturnType<typeof asPutRepoBody>

interface RepoPutResponseData {
  timestamp: number
}

const asPutRepoBody = asObject({
  repoId: asString,
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
    const response: ApiErrorResponse = {
      success: false,
      message: error.message
    }
    return res.status(400).json(response)
  }

  const path: string = `${body.repoId}:/`

  // Return HTTP 409 if repo already exists
  try {
    await dataStore.head(path)
    const result: ApiErrorResponse = {
      success: false,
      message: 'Datastore already exists'
    }
    res.status(409).json(result)
    return
  } catch (error) {
    // Throw response errors other than 404
    if (error.statusCode !== 404) {
      throw error
    }
  }

  // Create new repo
  const timestamp = Date.now()
  const repo: StoreRepoDocument = {
    paths: {},
    deleted: {},
    timestamp,
    lastGitHash: body.lastGitHash,
    lastGitTime: body.lastGitTime,
    size: 0,
    sizeLastCreated: 0,
    maxSize: 0
  }
  await dataStore.insert(repo, path)

  // Send response
  const response: ApiResponse<RepoPutResponseData> = {
    success: true,
    data: { timestamp }
  }
  res.status(201).json(response)
})
