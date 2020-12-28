import { asNumber, asObject } from 'cleaners'
import Router from 'express-promise-router'

import { updateDocuments, validateRepoTimestamp } from '../api/updateFiles'
import { asChangeSet, asPath, asRepoId } from '../types'
import { makeApiClientError, makeApiResponse } from '../util/utils'

type UpdateFilesBody = ReturnType<typeof asUpdateFilesBody>
const asUpdateFilesBody = asObject({
  repoId: asRepoId,
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
  const updateTimestamp = await updateDocuments(body.repoId, body.paths)

  // Response:

  res.status(200).json(
    makeApiResponse<UpdateFilesResponseData>({
      timestamp: updateTimestamp,
      paths: paths.reduce((paths, path) => {
        paths[path] = updateTimestamp
        return paths
      }, {})
    })
  )
})
