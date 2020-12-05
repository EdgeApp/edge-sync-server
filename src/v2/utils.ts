import { fetchGetFilesStoreFileMap } from '../api/getFiles'
import { RepoUpdates } from '../api/getUpdates'
import { ChangeSet } from './types'

export async function getChangesFromRepoUpdates(
  repoId: string,
  repoUpdates: RepoUpdates
): Promise<ChangeSet> {
  const { deleted, paths } = repoUpdates

  const getFilesStoreFileMap = await fetchGetFilesStoreFileMap(
    repoId,
    paths,
    true
  )

  const fileChanges: ChangeSet = Object.entries(getFilesStoreFileMap).reduce(
    (changes: ChangeSet, [path, fileOrDir]) => {
      if ('text' in fileOrDir) {
        const compatiblePath = path.substr(1)
        const file = fileOrDir
        try {
          changes[compatiblePath] = JSON.parse(file.text)
        } catch (_e) {
          changes[compatiblePath] = file.text
        }
      }
      return changes
    },
    {}
  )

  const deletedChanges: ChangeSet = Object.keys(deleted).reduce(
    (changes: ChangeSet, path) => {
      const compatiblePath = path.substr(1)
      changes[compatiblePath] = null
      return changes
    },
    {}
  )

  return { ...fileChanges, ...deletedChanges }
}
