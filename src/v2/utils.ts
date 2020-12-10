import { asMaybe } from 'cleaners'

import { asStoreFileWithTimestamp, fetchGetFilesMap } from '../api/getFiles'
import { RepoUpdates } from '../api/getUpdates'
import { ChangeSetV2 } from './types'

export async function getChangesFromRepoUpdates(
  repoId: string,
  repoUpdates: RepoUpdates
): Promise<ChangeSetV2> {
  const { deleted, paths } = repoUpdates

  const getFilesStoreFileMap = await fetchGetFilesMap(repoId, paths, true)

  const changes: ChangeSetV2 = {}

  Object.entries(getFilesStoreFileMap).forEach(([path, fileOrDir]) => {
    const file = asMaybe(asStoreFileWithTimestamp)(fileOrDir)

    // File should never be a directory
    if (file != null) {
      // Strip leading forward slash from path
      const compatiblePath = path.substr(1)
      // Return the file document's box
      changes[compatiblePath] = file.box
    } else {
      throw new Error(`Unexpected document type from change set`)
    }
  })

  Object.keys(deleted).forEach(path => {
    const compatiblePath = path.substr(1)
    changes[compatiblePath] = null
  })

  return changes
}
