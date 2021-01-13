import { lt } from 'biggystring'
import { asObject } from 'cleaners'
import { Router } from 'express'
import PromiseRouter from 'express-promise-router'

import { getDirectoryUpdates } from '../api/getUpdates'
import { getRepoDocument } from '../api/repo'
import {
  asRepoId,
  asTimestampRev,
  StoreFileTimestampMap,
  TimestampRev
} from '../types'
import { makeApiClientError, makeApiResponse } from '../util/utils'

type GetUpdatesBody = ReturnType<typeof asGetUpdatesBody>
const asGetUpdatesBody = asObject({
  repoId: asRepoId,
  timestamp: asTimestampRev
})

interface GetUpdatesResponseData {
  timestamp: TimestampRev
  paths: StoreFileTimestampMap
  deleted: StoreFileTimestampMap
}

export const getUpdatesRouter = (appState: any): Router => {
  const router = PromiseRouter()

  router.post('/getUpdates', async (req, res) => {
    let body: GetUpdatesBody

    try {
      body = asGetUpdatesBody(req.body)
    } catch (error) {
      throw makeApiClientError(400, error.message)
    }

    const { repoId, timestamp: clientTimestamp } = body
    const repoKey = `${repoId}:/`
    const repoDocument = await getRepoDocument(appState)(repoId)

    const responseData: GetUpdatesResponseData = {
      timestamp: clientTimestamp,
      paths: {},
      deleted: {}
    }

    if (lt(clientTimestamp, repoDocument.timestamp)) {
      const { paths, deleted, isConsistent } = await getDirectoryUpdates(
        appState
      )(repoKey, repoDocument, clientTimestamp)

      if (isConsistent) {
        responseData.timestamp = repoDocument.timestamp
      }

      responseData.paths = paths
      responseData.deleted = deleted
    }

    res.status(200).json(makeApiResponse<GetUpdatesResponseData>(responseData))
  })

  return router
}
