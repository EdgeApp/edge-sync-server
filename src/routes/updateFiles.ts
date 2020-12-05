import { asNumber, asObject } from 'cleaners'
import Router from 'express-promise-router'

import { updateFiles, validateRepoTimestamp } from '../api/updateFiles'
import { asChangeSet, asNonEmptyString, asPath } from '../types'
import { makeApiClientError, makeApiResponse } from '../utils'

type UpdateFilesBody = ReturnType<typeof asUpdateFilesBody>
const asUpdateFilesBody = asObject({
  repoId: asNonEmptyString,
  timestamp: asNumber,
  paths: asChangeSet
})

interface UpdateFilesResponseData {
  timestamp: number
  paths: {
    [path: string]: number
  }
}

export const updateFilesRouter = Router()

updateFilesRouter.post('/updateFiles', async (req, res) => {
  let body: UpdateFilesBody
  let paths: string[]

  // Validate request body
  try {
    body = asUpdateFilesBody(req.body)

    // Validate paths
    paths = Object.keys(body.paths).map(asPath)
  } catch (error) {
    throw makeApiClientError(400, error.message)
  }

  // Validate request body timestamp
  await validateRepoTimestamp(body.repoId, body.timestamp)

  // Update files
  const requestTimestamp = await updateFiles(body.repoId, body.paths)

  // Response:

  res.status(200).json(
    makeApiResponse<UpdateFilesResponseData>({
      timestamp: requestTimestamp,
      paths: paths.reduce((paths, path) => {
        paths[path] = requestTimestamp
        return paths
      }, {})
    })
  )
})
