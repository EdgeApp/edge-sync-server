import { asBoolean, asObject, asOptional } from 'cleaners'
import { Router } from 'express'
import PromiseRouter from 'express-promise-router'

import { fetchGetFilesMap, GetFilesMap } from '../api/getFiles'
import { migrateRepo } from '../api/migrations'
import { checkRepoExists } from '../api/repo'
import { config } from '../config'
import { AppState } from '../server'
import { asRepoId, asStoreFileTimestampMap } from '../types'
import { makeApiClientError, makeApiResponse } from '../util/utils'

type GetFilesBody = ReturnType<typeof asGetFilesBody>
const asGetFilesBody = asObject({
  repoId: asRepoId,
  ignoreTimestamps: asOptional(asBoolean),
  paths: asStoreFileTimestampMap
})

interface GetFilesResponseData {
  total: number
  paths: GetFilesMap
}

export const getFilesRouter = (appState: AppState): Router => {
  const router = PromiseRouter()

  router.post('/getFiles', async (req, res) => {
    let body: GetFilesBody

    // Validate request body
    try {
      body = asGetFilesBody(req.body)
    } catch (err) {
      throw makeApiClientError(400, err.message)
    }

    const { repoId, paths, ignoreTimestamps = false } = body

    // Use max page size config to limit the paths processed
    if (Object.keys(paths).length > config.maxPageSize) {
      throw makeApiClientError(
        422,
        `Too many paths. ` +
          `Total of ${paths.length} paths requested with maxPageSize of ${config.maxPageSize}`
      )
    }

    // Deprecate after migrations
    if (!(await checkRepoExists(appState)(repoId))) {
      try {
        await migrateRepo(appState)(repoId)
      } catch (error) {
        if (error.message === 'Repo not found') {
          throw makeApiClientError(404, `Repo '${repoId}' not found`)
        }
        throw error
      }
    }

    const getFilesStoreFileMap = await fetchGetFilesMap(appState)(
      repoId,
      paths,
      ignoreTimestamps
    )

    // Response:

    res.status(200).json(
      makeApiResponse<GetFilesResponseData>({
        total: Object.keys(getFilesStoreFileMap).length,
        paths: getFilesStoreFileMap
      })
    )
  })
  return router
}
