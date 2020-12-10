import { asObject } from 'cleaners'
import Router from 'express-promise-router'

import { checkRepoExists, createRepoDocument } from '../../api/repo'
import { asNonEmptyString } from '../../types'
import { makeApiClientError, makeApiResponse } from '../../utils'

type PutStoreParams = ReturnType<typeof asPutStoreParams>

interface PutStoreResponseData {
  timestamp: number
}

const asPutStoreParams = asObject({
  storeId: asNonEmptyString
})

export const putStoreRouter = Router()

putStoreRouter.put('/store/:storeId', async (req, res) => {
  let params: PutStoreParams

  // Request body validation
  try {
    params = asPutStoreParams(req.params)
  } catch (error) {
    throw makeApiClientError(400, error.message)
  }

  if (await checkRepoExists(params.storeId)) {
    throw makeApiClientError(409, 'Datastore already exists')
  }

  // Create new repo
  const timestamp = Date.now()

  await createRepoDocument(params.storeId, {
    timestamp
  })

  // Send response
  res.status(201).json(
    makeApiResponse<PutStoreResponseData>({ timestamp })
  )
})
