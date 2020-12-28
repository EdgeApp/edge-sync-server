import { dataStore } from '../db'
import { asStoreRepoDocument, StoreRepo, StoreRepoDocument } from '../types'
import { makeApiClientError } from '../util/utils'

export async function checkRepoExists(repoId: string): Promise<boolean> {
  const repoKey = `${repoId}:/`
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
  repoId: string,
  data: Pick<StoreRepo, 'timestamp' | 'lastGitHash' | 'lastGitTime'> &
    Partial<Pick<StoreRepo, 'paths' | 'deleted'>>
): Promise<void> {
  const repoKey = `${repoId}:/`

  const { paths = {}, deleted = {} } = data

  await dataStore.insert(
    {
      paths,
      deleted,
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

export async function getRepoDocument(
  repoId: string
): Promise<StoreRepoDocument> {
  const repoKey = `${repoId}:/`

  // Validate request body timestamp
  let repoDoc: StoreRepoDocument
  try {
    const repoQuery = await dataStore.get(repoKey)
    repoDoc = asStoreRepoDocument(repoQuery)
  } catch (err) {
    if (err.error === 'not_found') {
      throw makeApiClientError(404, `Repo '${repoId}' not found`)
    } else if (err instanceof TypeError) {
      throw new Error(`'${repoId}' is not a repo document`)
    } else {
      throw err
    }
  }

  return repoDoc
}
