import { asMaybe } from 'cleaners'

import { AppState } from '../server'
import {
  asStoreDirectoryDocument,
  asStoreFileDocument,
  asStoreRepoDocument,
  FilePointers,
  StoreDocument,
  StoreFileTimestampMap
} from '../types'
import { getNameFromPath, makeApiClientError } from '../util/utils'

export interface RepoUpdates {
  timestamp: number
  paths: StoreFileTimestampMap
  deleted: StoreFileTimestampMap
}

export const getRepoUpdates = (appState: AppState) => async (
  repoId: string,
  timestamp: number
): Promise<RepoUpdates> => {
  const repoKey = `${repoId}:/`

  let storeDocument: StoreDocument
  try {
    storeDocument = await appState.dataStore.get(repoKey)
  } catch (err) {
    if (err.error === 'not_found') {
      throw makeApiClientError(404, `Repo '${repoId}' not found`)
    } else {
      throw err
    }
  }

  const repoDocument = asMaybe(asStoreRepoDocument)(storeDocument)

  if (repoDocument == null) {
    throw new Error(`'${repoKey}' is not a repo document`)
  }

  let paths: StoreFileTimestampMap = {}
  let deleted: StoreFileTimestampMap = {}

  if (timestamp < repoDocument.timestamp) {
    const filePointers = await getDirectoryUpdates(appState)(
      repoKey.slice(0, -1),
      repoDocument,
      timestamp
    )

    paths = filePointers.paths
    deleted = filePointers.deleted
  }

  return {
    timestamp: repoDocument.timestamp,
    paths,
    deleted
  }
}

export const getDirectoryUpdates = (appState: AppState) => async (
  dirKey: string,
  dir: FilePointers,
  timestamp: number,
  isConsistent: boolean = true
): Promise<FilePointers & { isConsistent: boolean }> => {
  const rtn: FilePointers & { isConsistent: boolean } = {
    paths: {},
    deleted: {},
    isConsistent
  }

  // For repo keys, trim the trailing slash; dirs don't have trailing slashes
  if (dirKey[dirKey.length - 1] === '/') {
    dirKey = dirKey.substr(0, dirKey.length - 1)
  }

  // Filter out keys based on timestamp
  const pathsKeys = Object.entries(dir.paths)
    .filter(([_, documentTimestamp]) => documentTimestamp > timestamp)
    .map(([path]) => [dirKey, path].join('/'))

  const deletedKeys = Object.entries(dir.deleted)
    .filter(([_, documentTimestamp]) => documentTimestamp > timestamp)
    .map(([path]) => [dirKey, path].join('/'))

  const keysMap = {
    paths: pathsKeys,
    deleted: deletedKeys
  }

  for (const prop of Object.keys(keysMap)) {
    const keys = keysMap[prop]

    if (keys.length > 0) {
      const results = await appState.dataStore.fetch({ keys })
      for (const row of results.rows) {
        const documentKey = row.key
        const documentPath = documentKey.split(':')[1]
        const documentName = getNameFromPath(documentPath)
        // The timestamp for the document from the indexing document
        const documentTimestamp = dir[prop][documentName]

        if ('doc' in row) {
          const fileDocument = asMaybe(asStoreFileDocument)(row.doc)
          const directoryDocument = asMaybe(asStoreDirectoryDocument)(row.doc)

          if (fileDocument !== undefined) {
            if (
              prop !== 'deleted' &&
              fileDocument.timestamp !== documentTimestamp
            ) {
              rtn.isConsistent = false
            }

            rtn[prop][documentPath] = documentTimestamp
          } else if (directoryDocument !== undefined) {
            if (
              prop !== 'deleted' &&
              directoryDocument.timestamp !== documentTimestamp
            ) {
              rtn.isConsistent = false
            }

            const {
              paths: subPaths,
              deleted: subDeleted,
              isConsistent
            } = await getDirectoryUpdates(appState)(
              documentKey,
              directoryDocument,
              timestamp,
              rtn.isConsistent
            )

            rtn.paths = { ...rtn.paths, ...subPaths }
            rtn.deleted = { ...rtn.deleted, ...subDeleted }
            rtn.isConsistent = isConsistent
          } else {
            throw new Error(`Unexpected document for '${documentKey}'`)
          }
        } else {
          throw new Error(`Missing document '${documentKey}'`)
        }
      }
    }
  }

  return rtn
}
