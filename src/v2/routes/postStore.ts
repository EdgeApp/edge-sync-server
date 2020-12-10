import { asMaybe, asObject, asOptional } from 'cleaners'
import Router from 'express-promise-router'

import { getRepoUpdates, RepoUpdates } from '../../api/getUpdates'
import { updateDocuments, validateRepoTimestamp } from '../../api/updateFiles'
import {
  asApiClientError,
  asNonEmptyString,
  asPath,
  ChangeSet
} from '../../types'
import { makeApiClientError } from '../../utils'
import { asChangeSetV2, ChangeSetV2 } from '../types'
import { getChangesFromRepoUpdates } from '../utils'

export const postStoreRouter = Router()

type PostStoreParams = ReturnType<typeof asPostStoreParams>
const asPostStoreParams = asObject({
  storeId: asNonEmptyString,
  hash: asOptional(asNonEmptyString)
})

type PostStoreBody = ReturnType<typeof asPostStoreBody>
const asPostStoreBody = asObject({
  changes: asChangeSetV2
})

interface PostStoreResponseData {
  hash: string
  changes: ChangeSetV2
}

postStoreRouter.post('/store/:storeId/:hash?', async (req, res) => {
  let body: PostStoreBody
  let params: PostStoreParams
  // let paths: string[]

  // Validate request
  try {
    params = asPostStoreParams(req.params)
    body = asPostStoreBody(req.body)

    // Validate paths
    Object.keys(body.changes).map(path => asPath('/' + path))
  } catch (error) {
    throw makeApiClientError(400, error.message)
  }

  const repoId = params.storeId
  let clientTimestamp = params.hash != null ? parseInt(params.hash) : 0
  const changesPaths = Object.keys(body.changes)

  const changes: ChangeSet = Object.entries(body.changes).reduce(
    (changes: ChangeSet, [path, box]) => {
      const compatiblePath = '/' + path
      changes[compatiblePath] = box != null ? { box } : null
      return changes
    },
    {}
  )

  let repoUpdates: RepoUpdates | undefined

  try {
    // Validate request body timestamp
    await validateRepoTimestamp(repoId, clientTimestamp)
  } catch (error) {
    if (asMaybe(asApiClientError)(error) != null) {
      repoUpdates = await getRepoUpdates(repoId, clientTimestamp)
      clientTimestamp = repoUpdates.timestamp
    } else {
      throw error
    }
  }

  // Update files
  const updateTimestamp = await updateDocuments(repoId, changes)

  // Get diff of updates given and updates to send
  const changesDelta: ChangeSetV2 = {}
  if (repoUpdates != null) {
    const changes = await getChangesFromRepoUpdates(repoId, repoUpdates)

    Object.entries(changes).forEach(([path, change]) => {
      if (!changesPaths.includes(path)) {
        changesDelta[path] = change
      }
    })
  }

  const responseData: PostStoreResponseData = {
    hash: updateTimestamp.toString(),
    changes: changesDelta
  }

  res.status(200).json(responseData)
})
