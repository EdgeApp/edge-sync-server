import { asObject, asOptional } from 'cleaners'
import Router from 'express-promise-router'

import { getRepoUpdates, RepoUpdates } from '../../api/getUpdates'
import { getRepoDocument } from '../../api/repo'
import { updateDocuments } from '../../api/updateFiles'
import { asNonEmptyString, asPath, asRepoId, ChangeSet } from '../../types'
import { makeApiClientError } from '../../utils'
import { asChangeSetV2, ChangeSetV2 } from '../types'
import { getChangesFromRepoUpdates } from '../utils'

export const postStoreRouter = Router()

type PostStoreParams = ReturnType<typeof asPostStoreParams>
const asPostStoreParams = asObject({
  storeId: asRepoId,
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
  const clientTimestamp = params.hash != null ? parseInt(params.hash) : 0

  // Check if repo document exists and is a valid document using getRepoDocument
  await getRepoDocument(repoId)

  // Prepare changes for updateDocuments
  const changes: ChangeSet = Object.entries(body.changes).reduce(
    (changes: ChangeSet, [path, box]) => {
      const compatiblePath = '/' + path
      changes[compatiblePath] = box != null ? { box } : null
      return changes
    },
    {}
  )
  // Update documents using changes (files, directories, and repo)
  const updateTimestamp = await updateDocuments(repoId, changes)

  // Get updates using the client timestamp from request body
  const repoUpdates: RepoUpdates = await getRepoUpdates(repoId, clientTimestamp)
  // Convert updates into a V2 change set to send as response changes
  const responseChanges: ChangeSetV2 = await getChangesFromRepoUpdates(
    repoId,
    repoUpdates
  )

  // Response:

  const responseData: PostStoreResponseData = {
    hash: updateTimestamp.toString(),
    changes: responseChanges
  }
  res.status(200).json(responseData)
})
