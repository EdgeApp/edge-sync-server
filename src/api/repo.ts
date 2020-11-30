import { dataStore } from '../db'
import { StoreRepo } from '../types'

export async function checkRepoExists(repoKey: string): Promise<boolean> {
  try {
    await dataStore.head(repoKey)
    return true
  } catch (error) {
    // Throw response errors other than 404
    if (error.statusCode !== 404) {
      throw error
    }
    return false
  }
}

export async function createRepoDocument(
  repoKey: string,
  data: Pick<StoreRepo, 'timestamp' | 'lastGitHash' | 'lastGitTime'>
): Promise<void> {
  await dataStore.insert(
    {
      paths: {},
      deleted: {},
      timestamp: data.timestamp,
      lastGitHash: data.lastGitHash,
      lastGitTime: data.lastGitTime,
      size: 0,
      sizeLastCreated: 0,
      maxSize: 0
    },
    repoKey
  )
}
