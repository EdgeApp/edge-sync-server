import { lt, min } from 'biggystring'
import { Router } from 'express'
import PromiseRouter from 'express-promise-router'

import { getDirectoryUpdates } from '../api/getUpdates'
import { migrateRepo } from '../api/migrations'
import { checkRepoExists, getRepoDocument } from '../api/repo'
import { logger } from '../logger'
import { asGetUpdatesBody, GetUpdatesBody, GetUpdatesResponse } from '../types'
import { syncKeyToRepoId } from '../util/security'
import { makeApiClientError, makeApiResponse } from '../util/utils'

export const getUpdatesRouter = (appState: any): Router => {
  const router = PromiseRouter()

  router.post('/getUpdates', async (req, res) => {
    let body: GetUpdatesBody

    try {
      body = asGetUpdatesBody(req.body)
    } catch (error) {
      throw makeApiClientError(400, error.message)
    }

    const { syncKey, timestamp: clientTimestamp } = body
    const repoId = syncKeyToRepoId(syncKey)

    // Deprecate after migrations
    if (!(await checkRepoExists(appState)(repoId))) {
      try {
        await migrateRepo(appState)(syncKey)
      } catch (error) {
        if (error.message === 'Repo not found') {
          throw makeApiClientError(404, `Repo not found`)
        }
        throw error
      }
    }

    const repoDocKey = `${repoId}:/`
    const repoDocument = await getRepoDocument(appState)(repoId)

    const responseData: GetUpdatesResponse = {
      timestamp: clientTimestamp,
      paths: {},
      deleted: {}
    }

    if (lt(clientTimestamp, repoDocument.timestamp)) {
      const mergeBaseTimestamp = repoDocument.mergeBaseTimestamp
      const searchTimestamp =
        mergeBaseTimestamp != null
          ? min(mergeBaseTimestamp, clientTimestamp)
          : clientTimestamp

      const { paths, deleted, isConsistent } = await getDirectoryUpdates(
        appState
      )(repoDocKey, repoDocument, searchTimestamp)

      if (isConsistent) {
        responseData.timestamp = repoDocument.timestamp
      } else {
        logger.warn({ msg: `Inconsistent repo ${repoId}`, repoId })
      }

      responseData.paths = paths
      responseData.deleted = deleted
    }

    res.status(200).json(makeApiResponse<GetUpdatesResponse>(responseData))
  })

  return router
}
