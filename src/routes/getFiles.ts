import { asBoolean, asMap, asNumber, asObject, asOptional } from 'cleaners'
import Router from 'express-promise-router'

import {
  fetchGetFilesStoreFileMap,
  GetFilesStoreFileMap
} from '../api/getFiles'
import { asNonEmptyString } from '../types'
import { makeApiClientError, makeApiResponse } from '../utils'

type GetFilesBody = ReturnType<typeof asGetFilesBody>
const asGetFilesBody = asObject({
  repoId: asNonEmptyString,
  ignoreTimestamps: asOptional(asBoolean),
  paths: asMap(asNumber)
})

interface GetFilesResponseData {
  total: number
  paths: GetFilesStoreFileMap
}

export const getFilesRouter = Router()

getFilesRouter.post('/getFiles', async (req, res) => {
  let body: GetFilesBody

  // Validate request body
  try {
    body = asGetFilesBody(req.body)
  } catch (err) {
    throw makeApiClientError(400, err.message)
  }

  const { repoId, paths, ignoreTimestamps = false } = body

  const getFilesStoreFileMap = await fetchGetFilesStoreFileMap(
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
