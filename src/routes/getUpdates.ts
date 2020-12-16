import { asNumber, asObject } from 'cleaners'
import Router from 'express-promise-router'

import { getDirectoryUpdates } from '../api/getUpdates'
import { getRepoDocument } from '../api/repo'
import { asRepoId, StoreFileTimestampMap } from '../types'
import { makeApiClientError } from '../utils'

export const getUpdatesRouter = Router()

type GetUpdatesBody = ReturnType<typeof asGetUpdatesBody>
const asGetUpdatesBody = asObject({
  repoId: asRepoId,
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
  const repoDocument = await getRepoDocument(repoId)

  const responseData: GetUpdatesResponseData = {
    paths: {},
    deleted: {}
  }

  if (clientTimestamp < repoDocument.timestamp) {
    const { paths, deleted } = await getDirectoryUpdates(
      repoKey,
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
