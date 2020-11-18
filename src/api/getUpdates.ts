import { asMaybe } from 'cleaners'

import { dataStore } from '../db'
import {
  asStoreDirectoryDocument,
  asStoreFileDocument,
  asStoreRepoDocument,
  StoreDocument,
  StoreFileTimestampMap
} from '../types'
import { getNameFromPath, makeApiClientError } from '../utils'

export interface FilePointers {
  paths: StoreFileTimestampMap
  deleted: StoreFileTimestampMap
}

export interface RepoUpdates {
  timestamp: number
  paths: StoreFileTimestampMap
  deleted: StoreFileTimestampMap
}

export async function getRepoUpdates(
  repoId: string,
  timestamp: number
): Promise<RepoUpdates> {
  const repoKey = `${repoId}:/`

  let storeDocument: StoreDocument
  try {
    storeDocument = await dataStore.get(repoKey)
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
    const filePointers = await getDirectoryUpdates(
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

export async function getDirectoryUpdates(
  dirKey: string,
  dir: FilePointers,
  timestamp: number
): Promise<FilePointers> {
  const rtn: FilePointers = {
    paths: {},
    deleted: {}
  }

  const pathsKeys = Object.keys(dir.paths).map(path => [dirKey, path].join('/'))
  const deletedKeys = Object.keys(dir.deleted).map(path =>
    [dirKey, path].join('/')
  )

  const keysMapOfProp = {
    paths: pathsKeys,
    deleted: deletedKeys
  }

  for (const prop of Object.keys(keysMapOfProp)) {
    // Filter out keys based on timestamp
    const keys = keysMapOfProp[prop].filter(documentKey => {
      const documentPath = documentKey.split(':')[1]
      const documentName = getNameFromPath(documentPath)
      const documentTimestamp = dir[prop][documentName]

      return documentTimestamp > timestamp
    })

    if (keys.length > 0) {
      const results = await dataStore.fetch({ keys })
      for (const row of results.rows) {
        const documentKey = row.key
        const documentPath = documentKey.split(':')[1]
        const documentName = getNameFromPath(documentPath)
        const documentTimestamp = dir[prop][documentName]

        if ('doc' in row) {
          const fileDocument = asMaybe(asStoreFileDocument)(row.doc)
          const directoryDocument = asMaybe(asStoreDirectoryDocument)(row.doc)

          if (fileDocument !== undefined) {
            rtn[prop][documentPath] = documentTimestamp
          } else if (directoryDocument !== undefined) {
            const {
              paths: subPaths,
              deleted: subDeleted
            } = await getDirectoryUpdates(
              documentKey,
              directoryDocument,
              timestamp
            )

            rtn.paths = { ...rtn.paths, ...subPaths }
            rtn.deleted = { ...rtn.deleted, ...subDeleted }
          } else {
            throw new Error(`Unexpected document for '${documentKey}'`)
          }
        } else {
          throw new Error(`Missing document ${documentKey}`)
        }
      }
    }
  }

  return rtn
}
