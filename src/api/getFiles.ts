import { gt, lte } from 'biggystring'
import { asMaybe, asObject } from 'cleaners'

import { AppState } from '../server'
import {
  asStoreDirectoryDocument,
  asStoreFile,
  asStoreFileDocument,
  asStoreRepoDocument,
  asTimestampRev,
  StoreDirectoryDocument,
  StoreFileTimestampMap,
  TimestampRev
} from '../types'
import {
  getNameFromPath,
  getParentPathsOfPath,
  makeApiClientError
} from '../util/utils'
import { getConflictFreeDocuments } from './conflictResolution'

export interface GetFilesMap {
  [path: string]: StoreFileWithTimestamp | StoreDirectoryPathWithTimestamp
}

export type StoreFileWithTimestamp = ReturnType<typeof asStoreFileWithTimestamp>
export const asStoreFileWithTimestamp = asObject({
  ...asStoreFile.shape,
  timestamp: asTimestampRev
})

export interface StoreDirectoryPathWithTimestamp {
  paths: StoreFileTimestampMap
  timestamp: TimestampRev
}

export const fetchGetFilesMap = (appState: AppState) => async (
  repoId: string,
  requestPaths: StoreFileTimestampMap,
  ignoreTimestamps: boolean
): Promise<GetFilesMap> => {
  const paths = Object.keys(requestPaths)

  if (paths.length === 0) return {}

  interface ChildKeyToParentKeyMap {
    [childKey: string]: string
  }

  const childKeyToParentKeyMap = paths.reduce(
    (acc: ChildKeyToParentKeyMap, documentPath) => {
      const documentKey = `${repoId}:${documentPath}`
      const parentPaths = getParentPathsOfPath(documentPath)

      // Document is is a repo; it's parent is itself
      if (documentPath === '/') {
        return Object.assign(acc, { [documentKey]: documentKey })
      }

      const parentPath = parentPaths.length > 0 ? parentPaths[0] : '/'
      const parentKey = `${repoId}:${parentPath}`

      return Object.assign(acc, { [documentKey]: parentKey })
    },
    {}
  )

  const childKeys = Object.keys(childKeyToParentKeyMap)
  const parentKeys = Array.from(new Set(Object.values(childKeyToParentKeyMap)))

  interface StoreDirectoryDocumentMap {
    [documentKey: string]: StoreDirectoryDocument
  }

  const [parentDocumentResults, childDocumentResults] = await Promise.all([
    getConflictFreeDocuments(appState)(parentKeys),
    getConflictFreeDocuments(appState)(childKeys)
  ])

  const parentDocumentMap = parentDocumentResults.reduce(
    (map: StoreDirectoryDocumentMap, result) => {
      if ('error' in result) {
        if (result.error.error === 'not_found') {
          throw makeApiClientError(404, `Path '${result.key}' not found.`)
        }
        throw new Error(
          `Failed to get document: ${JSON.stringify(result.error)}`
        )
      }

      const doc = asMaybe(asStoreDirectoryDocument)(result.doc)

      if (doc == null) {
        throw new Error(`File '${result.key}' is not a directory.`)
      }

      return Object.assign(map, { [result.key]: doc })
    },
    {}
  )

  const responsePaths = childDocumentResults.reduce(
    (map: GetFilesMap, result) => {
      if ('error' in result) {
        if (result.error.error === 'not_found') {
          throw makeApiClientError(404, `Path '${result.key}' not found.`)
        }
        throw new Error(
          `Failed to get document: ${JSON.stringify(result.error)}`
        )
      }

      const documentKey = result.key
      const documentPath = documentKey.split(':')[1]
      const documentFileName = getNameFromPath(documentPath)

      const parentDocumentKey = childKeyToParentKeyMap[documentKey]
      const parentDocument = parentDocumentMap[parentDocumentKey]

      const sentTimestamp = requestPaths[documentPath]

      const fileDocument = asMaybe(asStoreFileDocument)(result.doc)
      const repoDocument = asMaybe(asStoreRepoDocument)(result.doc)
      const directoryDocument = asMaybe(asStoreDirectoryDocument)(result.doc)
      const directoryLikeDocument = repoDocument ?? directoryDocument

      // Because the repo's timestamp is included in the repo document
      // we have to get the timestamp from the repo document
      const timestamp =
        repoDocument == null
          ? parentDocument.paths[documentFileName]
          : repoDocument.timestamp

      if (!ignoreTimestamps && lte(timestamp, sentTimestamp)) return map

      // Handle file document
      if (fileDocument != null) {
        return Object.assign(map, {
          [documentPath]: asStoreFileWithTimestamp({
            ...fileDocument,
            timestamp
          })
        })
      }

      // Handle directory like document (repo or directory)
      if (directoryLikeDocument != null && ignoreTimestamps) {
        return Object.assign(map, {
          [documentPath]: { paths: directoryLikeDocument.paths, timestamp }
        })
      }
      if (directoryLikeDocument != null) {
        // Remove files after timestamp check
        const paths = Object.entries(directoryLikeDocument.paths).reduce(
          (paths: StoreFileTimestampMap, [fileName, fileTimestamp]) =>
            gt(fileTimestamp, sentTimestamp)
              ? { ...paths, [fileName]: fileTimestamp }
              : paths,
          {}
        )

        return Object.assign(map, {
          [documentPath]: { paths, timestamp }
        })
      }

      throw new Error(`File '${result.key}' is not a file or directory.`)
    },
    {}
  )

  return responsePaths
}
