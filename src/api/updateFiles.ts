import { lt } from 'biggystring'
import { DocumentBulkResponse } from 'nano'

import { AppState } from '../server'
import {
  asStoreDirectoryDocument,
  asStoreFileDocument,
  asTimestampRev,
  ChangeSet,
  FileChange,
  FilePointers,
  StoreDirectory,
  StoreDirectoryDocument,
  StoreFile,
  StoreFileDocument,
  StoreRepoDocument,
  TimestampRev
} from '../types'
import {
  getNameFromPath,
  getParentPathsOfPath,
  makeApiClientError,
  mergeFilePointers,
  withRetries
} from '../util/utils'
import {
  deleteLosingConflictingDocuments,
  getConflictFreeDocuments,
  makeTimestampHistory
} from './conflictResolution'
import { getRepoDocument } from './repo'

type DirLikeModification = Pick<
  StoreDirectory,
  'paths' | 'deleted' | 'timestamp'
>

export const validateRepoTimestamp = (appState: AppState) => async (
  repoId: string,
  timestamp: TimestampRev
): Promise<void> => {
  const repoDoc = await getRepoDocument(appState)(repoId)

  // Validate request body timestamp (timestamp >= repo timestamp is valid)
  if (lt(timestamp, repoDoc.timestamp)) {
    throw makeApiClientError(422, `Failed due to out-of-date timestamp`)
  }
}

export const updateDocuments = (appState: AppState) => (
  repoId: string,
  changeSet: ChangeSet
): Promise<TimestampRev> =>
  withRetries(
    async (): Promise<TimestampRev> => {
      const updateTimestamp = asTimestampRev(Date.now())
      const repoModification = await updateFilesAndDirectories(appState)(
        repoId,
        changeSet,
        updateTimestamp
      )
      await updateRepoDocument(appState)(repoId, repoModification)

      return updateTimestamp
    },
    err => err.message === 'conflict'
  )

export const updateFilesAndDirectories = (appState: AppState) => async (
  repoId: string,
  changeSet: ChangeSet,
  updateTimestamp: TimestampRev
): Promise<DirLikeModification> => {
  const fileKeys = Object.keys(changeSet).map(path => `${repoId}:${path}`)

  // Prepare Files Documents:
  const fileResults = await getConflictFreeDocuments(appState)(fileKeys)
  const storeFileDocuments: Array<StoreFileDocument | StoreFile> = []
  const directoryModifications: Map<string, DirLikeModification> = new Map()
  let repoModification: DirLikeModification = makeDirLikeModification()

  // Prepare file documents:
  fileResults.forEach(row => {
    const fileKey = row.key
    const [repoId, filePath] = fileKey.split(':')
    const fileChange: FileChange = changeSet[filePath]

    if ('doc' in row) {
      // We don't modify the file document for deletion
      if (fileChange !== null) {
        try {
          asStoreFileDocument(row.doc)
        } catch (err) {
          throw makeApiClientError(
            422,
            `Unable to write file '${filePath}'. ` +
              `Existing document is not a file.`
          )
        }

        // Document will be overwritten
        storeFileDocuments.push({
          ...fileChange,
          timestamp: updateTimestamp,
          _id: fileKey,
          _rev: row.doc._rev
        })
      }
    } else {
      // We must throw an exception when client wants to delete a file that
      // doesn't exist.
      if (fileChange !== null) {
        // Document will be inserted
        storeFileDocuments.push({
          ...fileChange,
          timestamp: updateTimestamp,
          _id: fileKey
        })
      } else {
        throw makeApiClientError(
          422,
          `Unable to delete file '${filePath}'. ` + `Document does not exist.`
        )
      }
    }

    // Directories and Repo Modifications:
    // Prepare Directory Modificaitons:
    const directoryPaths = getParentPathsOfPath(filePath)
    const fileName = getNameFromPath(filePath)

    directoryPaths.forEach((directoryPath, index) => {
      // Get the existing directory modification object
      const directoryKey = `${repoId}:${directoryPath}`
      const existingDirModification: DirLikeModification =
        directoryModifications.get(directoryKey) ?? makeDirLikeModification()

      // If this directory isn't the immediate parent directory of the file,
      // then we want to use the child directory for this directory as the
      // file pointer path.
      const childDirectoryPath = directoryPaths[index - 1]
      const filePointerPath =
        childDirectoryPath !== undefined
          ? getNameFromPath(childDirectoryPath)
          : fileName

      const updatedFilePointers = updateFilePointers(
        existingDirModification,
        filePointerPath,
        updateTimestamp,
        // Only delete if file pointer is the file (don't delete directories)
        fileChange === null && filePointerPath === fileName
      )

      const directoryModification: DirLikeModification = {
        ...existingDirModification,
        ...updatedFilePointers,
        timestamp: updateTimestamp
      }

      directoryModifications.set(directoryKey, directoryModification)
    })

    // Prepare Repo Modifications:
    // We want to use the top-most directory from the directory paths as the
    // file pointer path because it's the direct decendent from the repo.
    // This should be the last element in the directoryPaths.
    // If there are no directories and therefore no top-most directory, then
    // we use the file path as the file pointer path.
    const topMostDirectoryPath = directoryPaths[directoryPaths.length - 1]
    const filePointerPath =
      topMostDirectoryPath !== undefined
        ? getNameFromPath(topMostDirectoryPath)
        : fileName

    const updatedFilePointers = updateFilePointers(
      repoModification,
      filePointerPath,
      updateTimestamp,
      // Only delete if file pointer is the file (don't delete directories)
      fileChange === null && filePointerPath === fileName
    )

    repoModification = {
      ...updatedFilePointers,
      timestamp: updateTimestamp
    }
  })

  // Prepare Directories Documents:
  // Fetch existing documents to merge new document
  const directoryKeys = Array.from(directoryModifications.keys())
  const storeDirectoryDocuments: Array<
    StoreDirectoryDocument | (StoreDirectory & { _id: string })
  > = []
  if (directoryKeys.length > 0) {
    const directoryResults = await getConflictFreeDocuments(appState)(
      directoryKeys
    )

    // Prepare directory documents
    directoryResults.forEach(row => {
      const directoryKey = row.key
      const directoryPath = directoryKey.split(':')[1]
      const directoryModification = directoryModifications.get(directoryKey)

      if (directoryModification != null) {
        if ('doc' in row) {
          let existingDirectory: StoreDirectoryDocument

          try {
            existingDirectory = asStoreDirectoryDocument(row.doc)
          } catch (err) {
            throw makeApiClientError(
              422,
              `Unable to write files under '${directoryPath}'. ` +
                `Existing document is not a directory.`
            )
          }

          // Validate modificaiton
          validateModification(
            directoryModification,
            existingDirectory,
            directoryPath
          )

          const timestampHistory = makeTimestampHistory(
            appState.config.maxTimestampHistoryAge,
            existingDirectory
          )

          const directoryDocument: StoreDirectoryDocument = {
            ...existingDirectory,
            ...directoryModification,
            ...mergeFilePointers(existingDirectory, directoryModification),
            timestampHistory
          }

          // Update directory
          storeDirectoryDocuments.push(directoryDocument)
        } else {
          const newDirectory: StoreDirectory = {
            ...directoryModification,
            timestampHistory: makeTimestampHistory(
              appState.config.maxTimestampHistoryAge
            )
          }

          // Insert directory
          storeDirectoryDocuments.push({
            ...newDirectory,
            _id: directoryKey
          })
        }
      }
    })
  }

  // Write Files and Directories
  const fileAndDirResults = await appState.dataStore.bulk({
    docs: [...storeFileDocuments, ...storeDirectoryDocuments]
  })
  checkResultsForErrors(fileAndDirResults)

  // Delete any document conflicts
  await deleteLosingConflictingDocuments(appState)(
    fileAndDirResults.map(result => result.id)
  )

  return repoModification
}

export const updateRepoDocument = (appState: AppState) => async (
  repoId: string,
  repoModification: DirLikeModification
): Promise<void> => {
  const repoKey = `${repoId}:/`
  let storeRepoDocument: StoreRepoDocument

  try {
    const existingRepo: StoreRepoDocument = await getRepoDocument(appState)(
      repoId
    )

    // Validate modificaiton
    validateModification(repoModification, existingRepo, '')

    const timestampHistory = makeTimestampHistory(
      appState.config.maxTimestampHistoryAge,
      existingRepo
    )

    storeRepoDocument = {
      ...existingRepo,
      ...repoModification,
      ...mergeFilePointers(existingRepo, repoModification),
      timestampHistory
    }
  } catch (error) {
    if (error instanceof TypeError) {
      throw makeApiClientError(
        422,
        `Unable to write files under '${repoKey}'. ` + `Document is not a repo.`
      )
    }
    throw error
  }

  // Write Repos
  const repoResults = await appState.dataStore.bulk({
    docs: [storeRepoDocument]
  })
  checkResultsForErrors(repoResults)

  // Delete any document conflicts
  await deleteLosingConflictingDocuments(appState)(
    repoResults.map(result => result.id)
  )
}

// ---------------------------------------------------------------------
// Private
// ---------------------------------------------------------------------

const makeDirLikeModification = (): DirLikeModification => ({
  paths: {},
  deleted: {},
  timestamp: asTimestampRev(0)
})

const updateFilePointers = (
  filePointers: FilePointers,
  path: string,
  timestamp: TimestampRev,
  isDeletion: boolean
): FilePointers => {
  const mutations = {
    paths: isDeletion ? {} : { [path]: timestamp },
    deleted: isDeletion ? { [path]: timestamp } : {}
  }
  return {
    paths: {
      ...filePointers.paths,
      ...mutations.paths
    },
    deleted: {
      ...filePointers.deleted,
      ...mutations.deleted
    }
  }
}

const validateModification = (
  modification: DirLikeModification,
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

// This checks for conflicts and errors in the datastore write results
const checkResultsForErrors = (results: DocumentBulkResponse[]): void => {
  return results.forEach(result => {
    if (result.error !== '' && result.error !== undefined) {
      if (result.error === 'conflict') {
        // For conflict errors, throw specific error message
        throw new Error(result.error)
      } else {
        const reason = result.reason
        // For all other errors, throw because it's unexpected
        throw new Error(
          'Unexpected database error' +
            (reason !== '' && reason !== undefined ? ': ' + reason : '')
        )
      }
    }
  })
}
