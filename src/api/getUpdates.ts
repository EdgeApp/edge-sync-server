import { eq, gt, lt, min } from 'biggystring'
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
  const repoDocKey = `${repoId}:/`

  let repoDocument: StoreRepoDocument
  try {
    repoDocument = await getRepoDocument(appState)(repoId)
  } catch (err) {
    if (err.error === 'not_found') {
      throw makeApiClientError(404, `Repo not found`)
    } else {
      throw err
    }
  }

  let paths: StoreFileTimestampMap = {}
  let deleted: StoreFileTimestampMap = {}

  if (lt(timestamp, repoDocument.timestamp)) {
    const filePointers = await getDirectoryUpdates(appState)(
      repoDocKey.slice(0, -1),
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
  docKey: string,
  dir: FilePointers,
  searchTimestamp: TimestampRev,
  isConsistent: boolean = true
): Promise<FilePointers & { isConsistent: boolean }> => {
  const rtn: FilePointers & { isConsistent: boolean } = {
    paths: {},
    deleted: {},
    isConsistent
  }

  // For repo keys, trim the trailing slash; dirs don't have trailing slashes
  if (docKey[docKey.length - 1] === '/') {
    docKey = docKey.substr(0, docKey.length - 1)
  }

  // Filter out keys based on timestamp
  const pathsKeys = Object.entries(dir.paths)
    .filter(([_, documentTimestamp]) => gt(documentTimestamp, searchTimestamp))
    .map(([path]) => [docKey, path].join('/'))

  const deletedKeys = Object.entries(dir.deleted)
    .filter(([_, documentTimestamp]) => gt(documentTimestamp, searchTimestamp))
    .map(([path]) => [docKey, path].join('/'))

  const keysMap = {
    paths: pathsKeys,
    deleted: deletedKeys
  }

  const keys = Object.keys(keysMap) as Array<keyof typeof keysMap>

  for (const prop of keys) {
    const keys = keysMap[prop]

    if (keys.length > 0) {
      const results = await getConflictFreeDocuments(appState)(keys)

      for (const result of results) {
        const documentKey = result.key
        const documentPath = documentKey.split(':')[1]
        const documentName = getNameFromPath(documentPath)
        // The timestamp for the document from the indexing document
        const documentTimestamp = dir[prop][documentName]

        if ('doc' in result) {
          const fileDocument = asMaybe(asStoreFileDocument)(result.doc)
          const directoryDocument = asMaybe(asStoreDirectoryDocument)(
            result.doc
          )

          const mergeBaseTimestamp =
            fileDocument?.mergeBaseTimestamp ??
            directoryDocument?.mergeBaseTimestamp

          if (mergeBaseTimestamp != null) {
            searchTimestamp = min(mergeBaseTimestamp, searchTimestamp)
          }

          if (fileDocument !== undefined) {
            if (
              prop !== 'deleted' &&
              !eq(fileDocument.timestamp, documentTimestamp)
            ) {
              rtn.isConsistent = false
            }

            /*
            Return the timestamp from the parent pointer if the file is
            deleted otherwise return the timestamp from the file document.
            This is because when a file is deleted, the file document wont
            have the most up-to-date timestamp.
            */
            rtn[prop][documentPath] =
              prop === 'deleted'
                ? dir[prop][documentName]
                : fileDocument.timestamp
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
              searchTimestamp,
              rtn.isConsistent
            )

            rtn.paths = { ...rtn.paths, ...subPaths }
            rtn.deleted = { ...rtn.deleted, ...subDeleted }
            rtn.isConsistent = isConsistent
          } else {
            throw new Error(`Unexpected document for '${documentKey}'`)
          }
        } else {
          if (result.error !== 'not_found') {
            throw result
          }

          rtn.isConsistent = false
        }
      }
    }
  }

  return rtn
}
