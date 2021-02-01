import { Router } from 'express'
import PromsieRouter from 'express-promise-router'

import { updateDocuments, validateRepoTimestamp } from '../api/updateFiles'
import { AppState } from '../server'
import {
  asPath,
  asUpdateFilesBody,
  StoreFileTimestampMap,
  UpdateFilesBody,
  UpdateFilesResponse
} from '../types'
import { makeApiClientError, makeApiResponse } from '../util/utils'

export const updateFilesRouter = (appState: AppState): Router => {
  const router = PromsieRouter()

  router.post('/updateFiles', async (req, res) => {
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
    await validateRepoTimestamp(appState)(body.repoId, body.timestamp)

    // Update files
    const updateTimestamp = await updateDocuments(appState)(
      body.repoId,
      body.paths
    )

    // Response:

    res.status(200).json(
      makeApiResponse<UpdateFilesResponse>({
        timestamp: updateTimestamp,
        paths: paths.reduce<StoreFileTimestampMap>((paths, path) => {
          paths[path] = updateTimestamp
          return paths
        }, {})
      })
    )
  })
  return router
}
