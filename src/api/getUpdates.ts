import { eq, gt, lt } from 'biggystring'
import { asMaybe } from 'cleaners'

import { AppState } from '../server'
import {
  asStoreDirectoryDocument,
  asStoreFileDocument,
  FilePointers,
  StoreFileTimestampMap,
  StoreRepoDocument,
  TimestampRev
} from '../types'
import { getNameFromPath, makeApiClientError } from '../util/utils'
import { getConflictFreeDocuments } from './conflictResolution'
import { getRepoDocument } from './repo'

export interface RepoUpdates {
  timestamp: TimestampRev
  paths: StoreFileTimestampMap
  deleted: StoreFileTimestampMap
}

export const getRepoUpdates = (appState: AppState) => async (
  repoId: string,
  timestamp: TimestampRev
): Promise<RepoUpdates> => {
  const repoKey = `${repoId}:/`

  let repoDocument: StoreRepoDocument
  try {
    repoDocument = await getRepoDocument(appState)(repoId)
  } catch (err) {
    if (err.error === 'not_found') {
      throw makeApiClientError(404, `Repo '${repoId}' not found`)
    } else {
      throw err
    }
  }

  let paths: StoreFileTimestampMap = {}
  let deleted: StoreFileTimestampMap = {}

  if (lt(timestamp, repoDocument.timestamp)) {
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
  timestamp: TimestampRev,
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
    .filter(([_, documentTimestamp]) => gt(documentTimestamp, timestamp))
    .map(([path]) => [dirKey, path].join('/'))

  const deletedKeys = Object.entries(dir.deleted)
    .filter(([_, documentTimestamp]) => gt(documentTimestamp, timestamp))
    .map(([path]) => [dirKey, path].join('/'))

  const keysMap = {
    paths: pathsKeys,
    deleted: deletedKeys
  }

  for (const prop of Object.keys(keysMap)) {
    const keys = keysMap[prop]

    if (keys.length > 0) {
      const results = await getConflictFreeDocuments(appState)(keys)

      for (const row of results) {
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
              !eq(fileDocument.timestamp, documentTimestamp)
            ) {
              rtn.isConsistent = false
            }

            rtn[prop][documentPath] = documentTimestamp
          } else if (directoryDocument !== undefined) {
            if (
              prop !== 'deleted' &&
              !eq(directoryDocument.timestamp, documentTimestamp)
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
