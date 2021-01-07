import { asMaybe, asNumber, asObject } from 'cleaners'

import { AppState } from '../server'
import {
  asStoreDirectoryDocument,
  asStoreFile,
  asStoreFileDocument,
  asStoreRepoDocument,
  StoreDirectoryDocument,
  StoreFileTimestampMap
} from '../types'
import {
  getNameFromPath,
  getParentPathsOfPath,
  makeApiClientError
} from '../util/utils'

export interface GetFilesMap {
  [path: string]: StoreFileWithTimestamp | StoreDirectoryPathWithTimestamp
}

export type StoreFileWithTimestamp = ReturnType<typeof asStoreFileWithTimestamp>
export const asStoreFileWithTimestamp = asObject({
  ...asStoreFile.shape,
  timestamp: asNumber
})

export interface StoreDirectoryPathWithTimestamp {
  paths: StoreFileTimestampMap
  timestamp: number
}

export const fetchGetFilesMap = ({ dataStore }: AppState) => async (
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

  const [parentDocumentResult, childDocumentResult] = await Promise.all([
    dataStore.fetch({ keys: parentKeys }),
    dataStore.fetch({ keys: childKeys })
  ])

  const parentDocumentMap = parentDocumentResult.rows.reduce(
    (map: StoreDirectoryDocumentMap, row) => {
      if (row.error === 'not_found') {
        throw makeApiClientError(404, `Path '${row.key}' not found.`)
      }

      if (!('doc' in row)) throw new Error(row.error)

      const doc = asMaybe(asStoreDirectoryDocument)(row.doc)

      if (doc == null) throw new Error(`File '${row.key}' is not a directory.`)

      return Object.assign(map, { [row.key]: doc })
    },
    {}
  )

  const responsePaths = childDocumentResult.rows.reduce(
    (map: GetFilesMap, row) => {
      if (row.error === 'not_found') {
        throw makeApiClientError(404, `Path '${row.key}' not found.`)
      }

      if (!('doc' in row)) throw new Error(row.error)

      const documentKey = row.key
      const documentPath = documentKey.split(':')[1]
      const documentFileName = getNameFromPath(documentPath)

      const parentDocumentKey = childKeyToParentKeyMap[documentKey]
      const parentDocument = parentDocumentMap[parentDocumentKey]

      const sentTimestamp = requestPaths[documentPath]

      const fileDocument = asMaybe(asStoreFileDocument)(row.doc)
      const repoDocument = asMaybe(asStoreRepoDocument)(row.doc)
      const directoryDocument = asMaybe(asStoreDirectoryDocument)(row.doc)
      const directoryLikeDocument = repoDocument ?? directoryDocument

      // Because the repo's timestamp is included in the repo document
      // we have to get the timestamp from the repo document
      const timestamp =
        repoDocument == null
          ? parentDocument.paths[documentFileName]
          : repoDocument.timestamp

      if (!ignoreTimestamps && timestamp <= sentTimestamp) return map

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
            fileTimestamp > sentTimestamp
              ? { ...paths, [fileName]: fileTimestamp }
              : paths,
          {}
        )

        return Object.assign(map, {
          [documentPath]: { paths, timestamp }
        })
      }

      throw new Error(`File '${row.key}' is not a file or directory.`)
    },
    {}
  )

  return responsePaths
}
