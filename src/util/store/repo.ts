import {
  getConflictFreeDocuments,
  makeTimestampHistory
} from '../../api/conflictResolution'
import { AppState } from '../../server'
import {
  asStoreRepoDocument,
  StoreRepo,
  StoreRepoDocument
} from '../../types/old-types'
import { makeApiClientError } from '../utils'

export const checkRepoExists = (appState: AppState) => async (
  repoId: string
): Promise<boolean> => {
  const repoDocKey = `${repoId}:/`
  try {
    await appState.dataStore.head(repoDocKey)
    return true
  } catch (error) {
    // Throw response errors other than 404
    if (error.statusCode !== 404) {
      throw error
    }
    return false
  }
}

export const createRepoDocument = (appState: AppState) => async (
  repoId: string,
  data: Pick<StoreRepo, 'timestamp' | 'lastGitHash' | 'lastGitTime'> &
    Partial<Pick<StoreRepo, 'paths' | 'deleted'>>
): Promise<void> => {
  const repoDocKey = `${repoId}:/`

  const { paths = {}, deleted = {} } = data

  await appState.dataStore.insert(
    {
      paths,
      deleted,
      timestamp: data.timestamp,
      timestampHistory: makeTimestampHistory(
        appState.config.maxTimestampHistoryAge
      ),
      lastGitHash: data.lastGitHash,
      lastGitTime: data.lastGitTime,
      size: 0,
      sizeLastCreated: 0,
      maxSize: 0
    },
    repoDocKey
  )
}

export const getRepoDocument = (appState: AppState) => async (
  repoId: string
): Promise<
  StoreRepoDocument & { conflicts: Array<{ _id: string; _rev: string }> }
> => {
  const repoDocKey = `${repoId}:/`

  // Validate request body timestamp
  try {
    const repoResults = await getConflictFreeDocuments(appState)([repoDocKey])
    const repoResult = repoResults[0]

    if ('doc' in repoResult) {
      return {
        ...asStoreRepoDocument(repoResult.doc),
        conflicts: repoResult.conflicts
      }
    } else {
      if (repoResult.error === 'not_found') {
        throw makeApiClientError(404, `Repo not found`)
      }
      throw repoResult
    }
  } catch (err) {
    if (err instanceof TypeError) {
      throw new TypeError(`'${repoId}' is not a repo document`)
    }
    throw err
  }
}
