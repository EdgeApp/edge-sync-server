import { asMaybe } from 'cleaners'

import { fetchGetFilesMap } from '../api/getFiles'
import { RepoUpdates } from '../api/getUpdates'
import { getRepoDocument } from '../api/repo'
import { AppState } from '../server'
import {
  asStoreFileWithTimestamp,
  asTimestampRev,
  TimestampRev
} from '../types/old-types'
import { ChangeSetV2 } from './types'

export const getChangesFromRepoUpdates = (appState: AppState) => async (
  repoId: string,
  repoUpdates: RepoUpdates
): Promise<ChangeSetV2> => {
  const { deleted, paths } = repoUpdates

  const getFilesStoreFileMap = await fetchGetFilesMap(appState)(
    repoId,
    paths,
    true
  )

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

export const getTimestampRevFromHashParam = (appState: AppState) => async (
  repoId: string,
  hashParam: string | undefined
): Promise<TimestampRev> => {
  if (hashParam == null) return asTimestampRev(0)

  const timestampParam = asMaybe(asTimestampRev)(hashParam)
  if (timestampParam != null) return timestampParam

  const repoDoc = await getRepoDocument(appState)(repoId)
  if (repoDoc.lastGitTime != null && repoDoc.lastGitHash === hashParam)
    return asTimestampRev(repoDoc.lastGitTime)

  return asTimestampRev(0)
}
