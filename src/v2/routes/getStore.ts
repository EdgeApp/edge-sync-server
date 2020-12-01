import { asObject, asOptional } from 'cleaners'
import Router from 'express-promise-router'

import { getRepoUpdates } from '../../api/getUpdates'
import { asNonEmptyString } from '../../types'
import { makeApiClientError } from '../../utils'
import { ChangeSetV2 } from '../types'
import { getChangesFromRepoUpdates } from '../utils'

type GetStoreParams = ReturnType<typeof asGetStoreParams>
const asGetStoreParams = asObject({
  storeId: asNonEmptyString,
  hash: asOptional(asNonEmptyString)
})

interface GetStoreResponseData {
  hash: string
  changes: ChangeSetV2
}

export const getStoreRouter = Router()

getStoreRouter.get('/store/:storeId/:hash?', async (req, res) => {
  let params: GetStoreParams

  // Request body validation
  try {
    params = asGetStoreParams(req.params)
  } catch (error) {
    throw makeApiClientError(400, error.message)
  }

  const repoId = params.storeId
  const clientTimestamp = params.hash != null ? parseInt(params.hash) : 0

  const repoChanges = await getRepoUpdates(repoId, clientTimestamp)

  const changes: ChangeSetV2 = await getChangesFromRepoUpdates(
    repoId,
    repoChanges
  )

  const responseData: GetStoreResponseData = {
    hash: repoChanges.timestamp.toString(),
    changes
  }

  // Response:

  res.status(201).json(responseData)
})
