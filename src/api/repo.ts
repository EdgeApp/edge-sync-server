import { AppState } from '../server'
import { asStoreRepoDocument, StoreRepo, StoreRepoDocument } from '../types'
import { makeApiClientError } from '../util/utils'
import {
  getConflictFreeDocuments,
  makeTimestampHistory
} from './conflictResolution'

export const checkRepoExists = (appState: AppState) => async (
  repoId: string
): Promise<boolean> => {
  const repoKey = `${repoId}:/`
  try {
    await appState.dataStore.head(repoKey)
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
  const repoKey = `${repoId}:/`

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
    repoKey
  )
}

export const getRepoDocument = (appState: AppState) => async (
  repoId: string
): Promise<
  StoreRepoDocument & { conflicts: Array<{ _id: string; _rev: string }> }
> => {
  const repoKey = `${repoId}:/`

  // Validate request body timestamp
  try {
    const repoResults = await getConflictFreeDocuments(appState)([repoKey])
    const repoResult = repoResults[0]

    if ('doc' in repoResult) {
      return {
        ...asStoreRepoDocument(repoResult.doc),
        conflicts: repoResult.conflicts
      }
    } else {
      if (repoResult.error === 'not_found') {
        throw makeApiClientError(404, `Repo '${repoId}' not found`)
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
