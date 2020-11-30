import { asMaybe, asObject, asOptional } from 'cleaners'
import Router from 'express-promise-router'

import { getRepoUpdates, RepoUpdates } from '../../api/getUpdates'
import { updateFiles, validateRepoTimestamp } from '../../api/updateFiles'
import {
  asApiClientError,
  asNonEmptyString,
  asPath,
  StoreFile,
  StoreFileMap
} from '../../types'
import { makeApiClientError } from '../../utils'
import { asChangeSet, ChangeSet } from '../types'
import { getChangesFromRepoUpdates } from '../utils'

export const postStoreRouter = Router()

type PostStoreParams = ReturnType<typeof asPostStoreParams>
const asPostStoreParams = asObject({
  storeId: asNonEmptyString,
  hash: asOptional(asNonEmptyString)
})

type PostStoreBody = ReturnType<typeof asPostStoreBody>
const asPostStoreBody = asObject({
  changes: asChangeSet
})

interface PostStoreResponseData {
  hash: string
  changes: ChangeSet
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
  const changeList = body.changes
  const changeListPaths = Object.keys(changeList)

  const storeFileMap: StoreFileMap = Object.entries(changeList).reduce(
    (paths: StoreFileMap, [path, data]) => {
      const compatiblePath = '/' + path
      let storeFile: StoreFile | null

      if (typeof data === 'object' && data !== null) {
        storeFile = { text: JSON.stringify(data) }
      } else if (typeof data === 'string') {
        storeFile = { text: data }
      } else {
        storeFile = null
      }

      paths[compatiblePath] = storeFile

      return paths
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
  const requestTimestamp = await updateFiles(repoId, storeFileMap)

  // Get diff of updates given and updates to send
  const changesDelta: ChangeSet = {}
  if (repoUpdates != null) {
    const changes = await getChangesFromRepoUpdates(repoId, repoUpdates)

    Object.entries(changes).forEach(([path, change]) => {
      if (!changeListPaths.includes(path)) {
        changesDelta[path] = change
      }
    })
  }

  const responseData: PostStoreResponseData = {
    hash: requestTimestamp.toString(),
    changes: changesDelta
  }

  res.status(200).json(responseData)
})
