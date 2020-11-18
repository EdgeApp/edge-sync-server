import { ApiClientError, StoreDirectory } from './types'

export const makeApiClientError = (
  status: number,
  message: string
): ApiClientError => {
  return {
    status,
    message
  }
}

export const getNameFromPath = (path: string): string => {
  const pathParts = path.split('/')
  return pathParts[pathParts.length - 1]
}

/**
 * Returns an array of paths for each ancestory directory of a given
 * file path starting with immediate parent directory to the top-most
 * directory (which is the directory below the repo directory).
 *
 * Example: '/dir1/dir2/file.txt' -> ['/dir1/dir2/', '/dir1']
 *
 * @param path full path to a file
 */
export const getParentPathsOfPath = (path: string): string[] => {
  const pathsSet = new Set<string>()
  const parts = path.replace(/^\/+|\/+$/g, '').split('/')

  for (let i = parts.length - 1; i > 0; --i) {
    pathsSet.add('/' + parts.slice(0, i).join('/'))
  }

  return Array.from(pathsSet)
}

export const mergeDirectoryFilePointers = <T extends StoreDirectory>(
  leftDir: T,
  rightDir: StoreDirectory
): T => {
  const deleted = { ...leftDir.deleted, ...rightDir.deleted }
  const paths = { ...leftDir.paths, ...rightDir.paths }

  // In order to successfully merge changes into document, we must remove
  // keys present in deleted that have moved to paths, or visa versa.
  Object.keys(rightDir.deleted).forEach(path => {
    delete paths[path]
  })
  Object.keys(rightDir.paths).forEach(path => {
    delete deleted[path]
  })

  return {
    ...leftDir,
    ...rightDir,
    deleted,
    paths
  }
}

export const updateDirectoryFilePointers = (
  directory: StoreDirectory | undefined,
  path: string,
  timestamp: number,
  isDeletion: boolean
): StoreDirectory => {
  const directoryMutations = {
    paths: isDeletion ? {} : { [path]: timestamp },
    deleted: isDeletion ? { [path]: timestamp } : {}
  }
  return {
    paths: {
      ...directory?.paths,
      ...directoryMutations.paths
    },
    deleted: {
      ...directory?.deleted,
      ...directoryMutations.deleted
    }
  }
}
