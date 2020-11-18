import { asNumber, asObject, asString } from 'cleaners'
import Router from 'express-promise-router'

import { getDirectoryUpdates } from '../api/getUpdates'
import { dataStore } from '../db'
import {
  asStoreRepoDocument,
  StoreFileTimestampMap,
  StoreRepoDocument
} from '../types'
import { makeApiClientError } from '../utils'

export const getUpdatesRouter = Router()

type GetUpdatesBody = ReturnType<typeof asGetUpdatesBody>
const asGetUpdatesBody = asObject({
  repoId: asString,
  timestamp: asNumber
})

interface GetUpdatesResponseData {
  paths: StoreFileTimestampMap
  deleted: StoreFileTimestampMap
}

getUpdatesRouter.post('/getUpdates', async (req, res) => {
  let body: GetUpdatesBody

  try {
    body = asGetUpdatesBody(req.body)
  } catch (error) {
    throw makeApiClientError(400, error.message)
  }

  const { repoId, timestamp: clientTimestamp } = body
  const repoKey = `${repoId}:/`

  let repoDocument: StoreRepoDocument
  try {
    const repoDocumentResult = await dataStore.get(repoKey)
    repoDocument = asStoreRepoDocument(repoDocumentResult)
  } catch (err) {
    if (err.error === 'not_found') {
      throw makeApiClientError(404, `Repo '${repoId}' not found`)
    } else if (err instanceof TypeError) {
      throw new Error(`'${repoKey}' is not a repo document`)
    } else {
      throw err
    }
  }

  const responseData: GetUpdatesResponseData = {
    paths: {},
    deleted: {}
  }

  if (clientTimestamp < repoDocument.timestamp) {
    const { paths, deleted } = await getDirectoryUpdates(
      repoKey.slice(0, -1),
      repoDocument,
      clientTimestamp
    )

    responseData.paths = paths
    responseData.deleted = deleted

    res.status(200).json(responseData)
  } else {
    res.status(200).json(responseData)
  }
})
