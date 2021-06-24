import { eq, lt } from 'biggystring'
import { asEither, asMaybe } from 'cleaners'
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
  StoreDocument,
  StoreFile,
  StoreFileDocument,
  StoreRepoDocument,
  TimestampRev
} from '../types/old-types'
import { getRepoDocument } from '../util/store/repo'
import {
  delay,
  getNameFromPath,
  getParentPathsOfPath,
  makeApiClientError,
  mergeFilePointers,
  withRetries
} from '../util/utils'
import {
  deleteDocuments,
  getConflictFreeDocuments,
  makeTimestampHistory
} from './conflictResolution'

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

      try {
        // Check if repo is inconsistent
        await checkChangeSetDocumentsConsistency(appState)(repoId, changeSet)
      } catch (error) {
        // Throw the error to retry after delaying for 1 second
        await delay(1000)
        throw error
      }

      const repoModification = await updateFilesAndDirectories(appState)(
        repoId,
        changeSet,
        updateTimestamp
      )
      await updateRepoDocument(appState)(repoId, repoModification)

      return updateTimestamp
    },
    err => err.message === 'conflict' || /^Inconsistent: .*$/.test(err.message)
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

  const conflictDocs: Array<{ _id: string; _rev: string }> = []

  // Prepare file documents:
  fileResults.forEach(result => {
    const fileKey = result.key
    const [repoId, filePath] = fileKey.split(':')
    const fileChange: FileChange = changeSet[filePath]

    if ('doc' in result) {
      // We don't modify the file document for deletion
      if (fileChange !== null) {
        try {
          asStoreFileDocument(result.doc)
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
          _rev: result.doc._rev
        })

        conflictDocs.push(...result.conflicts)
      }
    } else {
      // Throw on errors other than not_found
      if (result.error !== 'not_found') {
        throw result
      }

      // We must throw an exception when client wants to delete a file that
      // doesn't exist.
      if (fileChange === null) {
        throw makeApiClientError(
          422,
          `Unable to delete file '${filePath}'. ` + `Document does not exist.`
        )
      }

      // Document will be inserted because it is not found
      storeFileDocuments.push({
        ...fileChange,
        timestamp: updateTimestamp,
        _id: fileKey
      })
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
    directoryResults.forEach(result => {
      const directoryKey = result.key
      const directoryPath = directoryKey.split(':')[1]
      const directoryModification = directoryModifications.get(directoryKey)

      if (directoryModification != null) {
        if ('doc' in result) {
          let existingDirectory: StoreDirectoryDocument

          try {
            existingDirectory = asStoreDirectoryDocument(result.doc)
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

          conflictDocs.push(...result.conflicts)
        } else {
          // Throw on errors other than not_found
          if (result.error !== 'not_found') {
            throw result
          }

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
  await deleteDocuments(appState)(conflictDocs)

  return repoModification
}

export const updateRepoDocument = (appState: AppState) => async (
  repoId: string,
  repoModification: DirLikeModification
): Promise<void> => {
  const repoDocKey = `${repoId}:/`
  let storeRepoDocument: StoreRepoDocument
  const conflictDocs: Array<{ _id: string; _rev: string }> = []

  try {
    const existingRepo = await getRepoDocument(appState)(repoId)

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
    conflictDocs.push(...existingRepo.conflicts)
  } catch (error) {
    if (error instanceof TypeError) {
      throw makeApiClientError(
        422,
        `Unable to write files under '${repoDocKey}'. ` +
          `Document is not a repo.`
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
  await deleteDocuments(appState)(conflictDocs)
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

const checkChangeSetDocumentsConsistency = (appState: AppState) => async (
  repoId: string,
  changeSet: ChangeSet
): Promise<void> => {
  const paths = Object.keys(changeSet)
  const repoDocumentKey = `${repoId}:/`

  // Set of all document keys for every document affected in the changeset
  const documentKeysSet = paths.reduce<Set<string>>((documentKeys, path) => {
    // Add document key for full path
    documentKeys.add(`${repoId}:${path}`)

    // Add document keys for each parent path
    const parentPaths = getParentPathsOfPath(path)
    for (const parentPath of parentPaths) {
      documentKeys.add(`${repoId}:${parentPath}`)
    }

    // Return the set accumulator
    return documentKeys
  }, new Set([repoDocumentKey]))

  // Array of the document keys
  const documentKeys = [...documentKeysSet]

  /*
  Create a graph of each parent document key to a set of child document keys.
  Example:
    {
      'repoId:/dir1': [
        'repoId:/dir1/file1.txt',
        'repoId:/dir1/file2.txt',
        'repoId:/dir1/subdir'
      ],
      'repoId:/dir1/subdir': ['repoId:/dir1/subdir/somefile.tar']
    }
  */
  const documentKeyGraph = documentKeys.reduce<Map<string, string[]>>(
    (documentKeyGraph, documentKey) => {
      // Ignore repo document key
      if (documentKey === repoDocumentKey) return documentKeyGraph

      // The document path from document key
      const [, documentPath] = documentKey.split(':')
      // The parent paths from document path
      const parentPaths = getParentPathsOfPath(documentPath)

      // The immediate parent document path
      const directParentPath = parentPaths[0] ?? '/'
      // The immediate parent document key
      const directParentKey = `${repoId}:${directParentPath}`

      // The parent document's edges in the graph (the child keys)
      const keys = documentKeyGraph.get(directParentKey) ?? []

      // Update the edges (child keys)
      documentKeyGraph.set(directParentKey, [...keys, documentKey])

      // Return the graph accumulator
      return documentKeyGraph
    },
    new Map()
  )

  // Query for documents
  const documentResults = await getConflictFreeDocuments(appState)(documentKeys)

  // Map each document key to its StoreDocument
  const storeDocumentMap = documentResults.reduce<Map<string, StoreDocument>>(
    (storeDocumentMap, result) => {
      // Handle error cases
      if ('error' in result) {
        if (result.error !== 'not_found') {
          throw result
        }
        return storeDocumentMap
      }

      // Set the document key to map to the StoreDocument
      storeDocumentMap.set(result.key, result.doc)

      // Return map accumulator
      return storeDocumentMap
    },
    new Map()
  )

  // Iterate over each document key and check if its timestamp is consistent
  // with its pointer timestamp in the parent document.
  for (const [parentKey, childKeys] of documentKeyGraph.entries()) {
    const doc = storeDocumentMap.get(parentKey)
    const parentStoreDirectoryDocument = asMaybe(asStoreDirectoryDocument)(doc)

    for (const childKey of childKeys) {
      const [, childDocumentPath] = childKey.split(':')
      const childDocmentName = getNameFromPath(childDocumentPath)

      // Get the file pointer timestamp for the child document
      const filePointerTimestamp =
        parentStoreDirectoryDocument != null
          ? parentStoreDirectoryDocument.paths[childDocmentName]
          : undefined
      // Get the deleted file pointer timestamp for the child document
      const deletedFilePointerTimestamp =
        parentStoreDirectoryDocument != null
          ? parentStoreDirectoryDocument.deleted[childDocmentName]
          : undefined
      // Get the child document
      const childDoc = storeDocumentMap.get(childKey)

      if (filePointerTimestamp == null) {
        // This is a new document if both file pointer and document aren't present
        if (childDoc == null) continue
        // This is a deleted document if deleted file pointer is present
        if (deletedFilePointerTimestamp != null) continue
        // Otherise, inconsistent if no file pointer for child document
        throw new Error(
          `Inconsistent: File pointer in '${parentKey}' missing for document '${childKey}'`
        )
      }

      // Inconsistent if child doc is missing while a file pointer is present
      if (childDoc == null)
        throw new Error(
          `Inconsistent: Document '${childKey}' missing for file pointer in '${parentKey}'`
        )

      const childStoreFileOrDirDocument = asMaybe(
        asEither(asStoreFileDocument, asStoreDirectoryDocument)
      )(childDoc)

      if (childStoreFileOrDirDocument != null) {
        // Inconsistent if pointer timestamp and document timestamp don't match
        if (!eq(filePointerTimestamp, childStoreFileOrDirDocument.timestamp))
          throw new Error(
            `Inconsistent: Document timestamp and file pointer mismatch for '${childKey}'`
          )
        continue
      }

      throw new Error(`Unexpected document type during repo consistency check`)
    }
  }
}
