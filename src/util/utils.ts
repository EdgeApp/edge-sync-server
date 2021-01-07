import {
  ApiClientError,
  ApiResponse,
  FilePointers,
  StoreDirectory
} from '../types'

export const makeApiClientError = (
  status: number,
  message: string
): ApiClientError => {
  return new ApiClientError(status, message)
}

export const makeApiResponse = <T>(data: T): ApiResponse<T> => {
  return {
    success: true,
    data
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

export const mergeFilePointers = (
  left: FilePointers,
  right: FilePointers
): FilePointers => {
  const allKeys = new Set([
    ...Object.keys(left.paths),
    ...Object.keys(left.deleted),
    ...Object.keys(right.paths),
    ...Object.keys(right.deleted)
  ])
  const filePointers = { paths: {}, deleted: {} }

  for (const key of allKeys) {
    const filePointerMap = {
      [left.paths[key] ?? -1]: filePointers.paths,
      [left.deleted[key] ?? -1]: filePointers.deleted,
      [right.paths[key] ?? -1]: filePointers.paths,
      [right.deleted[key] ?? -1]: filePointers.deleted
    }

    const greatestTimestamp = Math.max(
      ...Object.keys(filePointerMap).map(key => parseInt(key))
    )
    filePointerMap[greatestTimestamp][key] = greatestTimestamp
  }

  return filePointers
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
    timestamp,
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

export const validateModification = (
  modification: StoreDirectory,
  directory: StoreDirectory,
  directoryPath: string
): void => {
  const deletedFilePaths = Object.keys(directory.deleted)

  // Deleted paths must not be already deleted
  Object.keys(modification.deleted).forEach(fileName => {
    const filePath = `${directoryPath}/${fileName}`

    if (deletedFilePaths.includes(fileName)) {
      throw makeApiClientError(
        422,
        `Unable to delete file '${filePath}'. ` + `File is already deleted.`
      )
    }
  })
}

/**
 * Wraps a function and invokes the function with rety attemps if error passes
 * a condition function.
 *
 * @param fn An async funciton to invoke with retry attempts
 * @param condition A function that returns a boolean given the error thrown
 * @param maxRetries Max number of retries (default 100)
 */

export const withRetries = async <T>(
  fn: () => Promise<T>,
  condition: (err: any) => boolean,
  maxRetries: number = 100
): Promise<T> => {
  let result: T
  let retries: number = 0

  while (true) {
    if (retries === maxRetries) {
      throw new Error(
        `Failed to resolve conflicts after ${maxRetries} attempts`
      )
    }

    try {
      result = await fn()
    } catch (err) {
      if (condition(err)) {
        retries += 1
        continue
      }
      throw err
    }

    break
  }

  return result
}
