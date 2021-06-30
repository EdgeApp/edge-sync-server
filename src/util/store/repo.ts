import { AppState } from '../../server'
import { StoreRepo } from '../../types/store-types'

export const checkRepoExists = (appState: AppState) => async (
  repoId: string
): Promise<boolean> => {
  const repoDocKey = `${repoId}:/`
  try {
    await appState.storeDb.head(repoDocKey)
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
  data: Pick<StoreRepo, 'timestamp' | 'lastGitHash' | 'lastGitTime'>
): Promise<void> => {
  const repoDocKey = `${repoId}:/`

  await appState.storeDb.insert(
    {
      timestamp: data.timestamp,
      lastGitHash: data.lastGitHash,
      lastGitTime: data.lastGitTime,
      size: 0,
      sizeLastCreated: 0,
      maxSize: 0
    },
    repoDocKey
  )
}
