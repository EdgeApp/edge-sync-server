import { DocumentBulkResponse } from 'nano'

import { dataStore } from '../db'
import {
  asStoreDirectoryDocument,
  asStoreFileDocument,
  asStoreRepoDocument,
  ChangeSet,
  FileChange,
  StoreDirectory,
  StoreDirectoryDocument,
  StoreFileDocument,
  StoreRepoDocument
} from '../types'
import {
  getNameFromPath,
  getParentPathsOfPath,
  makeApiClientError,
  mergeDirectoryFilePointers,
  updateDirectoryFilePointers,
  validateModification,
  withRetries
} from '../util/utils'
import { getRepoDocument } from './repo'

type RepoModification = Pick<
  StoreRepoDocument,
  'paths' | 'deleted' | 'timestamp'
>

export async function validateRepoTimestamp(repoId, timestamp): Promise<void> {
  const repoDoc = await getRepoDocument(repoId)

  // Validate request body timestamp
  if (repoDoc.timestamp !== timestamp) {
    throw makeApiClientError(422, `Failed due to out-of-date timestamp`)
  }
}

export function updateDocuments(
  repoId: string,
  changeSet: ChangeSet
): Promise<number> {
  return withRetries(
    async (): Promise<number> => {
      const updateTimestamp = Date.now()
      const repoModification = await updateFilesAndDirectories(
        repoId,
        changeSet,
        updateTimestamp
      )
      await updateRepoDocument(repoId, repoModification)

      return updateTimestamp
    },
    err => err.message === 'conflict'
  )
}

export async function updateFilesAndDirectories(
  repoId: string,
  changeSet: ChangeSet,
  updateTimestamp: number
): Promise<RepoModification> {
  const fileKeys = Object.keys(changeSet).map(path => `${repoId}:${path}`)

  // Prepare Files Documents:
  const fileRevsResult = await dataStore.fetch({ keys: fileKeys })
  const storeFileDocuments: StoreFileDocument[] = []
  const directoryModifications: Map<string, StoreDirectory> = new Map()
  let repoModification: RepoModification = {
    paths: {},
    deleted: {},
    timestamp: 0
  }

  // Prepare file documents:
  fileRevsResult.rows.forEach(row => {
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
          _id: fileKey,
          _rev: row.value.rev
        })
      }
    } else {
      // We must throw an exception when client wants to delete a file that
      // doesn't exist.
      if (fileChange !== null) {
        // Document will be inserted
        storeFileDocuments.push({ ...fileChange, _id: fileKey })
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
      const existingDirModification = directoryModifications.get(directoryKey)

      // If this directory isn't the immediate parent directory of the file,
      // then we want to use the child directory for this directory as the
      // file pointer path.
      const childDirectoryPath = directoryPaths[index - 1]
      const filePointerPath =
        childDirectoryPath !== undefined
          ? getNameFromPath(childDirectoryPath)
          : fileName

      const directoryModification = updateDirectoryFilePointers(
        existingDirModification,
        filePointerPath,
        updateTimestamp,
        // Only delete if file pointer is the file (don't delete directories)
        fileChange === null && filePointerPath === fileName
      )

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

    repoModification = {
      ...updateDirectoryFilePointers(
        repoModification,
        filePointerPath,
        updateTimestamp,
        // Only delete if file pointer is the file (don't delete directories)
        fileChange === null && filePointerPath === fileName
      ),
      timestamp: updateTimestamp
    }
  })

  // Prepare Directories Documents:
  // Fetch existing documents to merge new document
  const directoryKeys = Array.from(directoryModifications.keys())
  const storeDirectoryDocuments: StoreDirectoryDocument[] = []
  if (directoryKeys.length > 0) {
    const directoryFetchResult = await dataStore.fetch({ keys: directoryKeys })

    // Prepare directory documents
    directoryFetchResult.rows.forEach(row => {
      const directoryKey = row.key
      const directoryPath = directoryKey.split(':')[1]
      const directoryModification = directoryModifications.get(directoryKey)

      if (directoryModification !== undefined) {
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

          const directoryDocument: StoreDirectoryDocument = mergeDirectoryFilePointers(
            existingDirectory,
            directoryModification
          )

          // Update directory
          storeDirectoryDocuments.push(directoryDocument)
        } else {
          // Insert directory
          storeDirectoryDocuments.push({
            ...directoryModification,
            _id: directoryKey
          })
        }
      }
    })
  }

  // Write Files and Directories
  const fileAndDirResults = await dataStore.bulk({
    docs: [...storeFileDocuments, ...storeDirectoryDocuments]
  })
  checkResultsForErrors(fileAndDirResults)

  return repoModification
}

export const updateRepoDocument = async (
  repoId: string,
  repoModification: RepoModification
): Promise<void> => {
  const repoKey = `${repoId}:/`

  // Prepare Repo Document:
  const repoFetchResult = await dataStore.fetch({ keys: [repoKey] })
  const storeRepoDocuments: StoreRepoDocument[] = []

  // Prepare repo documents
  repoFetchResult.rows.forEach(row => {
    const repoKey = row.key

    if ('doc' in row) {
      let existingRepo: StoreRepoDocument

      try {
        existingRepo = asStoreRepoDocument(row.doc)
      } catch (err) {
        throw makeApiClientError(
          422,
          `Unable to write files under '${repoKey}'. ` +
            `Document is not a repo.`
        )
      }

      // Validate modificaiton
      validateModification(repoModification, existingRepo, '')

      const repoDocument: StoreRepoDocument = mergeDirectoryFilePointers(
        existingRepo,
        repoModification
      )

      storeRepoDocuments.push(repoDocument)
    } else {
      // If no existing StoreRootDocument, then we should throw a client error
      throw makeApiClientError(
        422,
        `Unable to write files under '${repoKey}'. ` +
          `Document does not exist.`
      )
    }
  })

  // Write Repos
  const repoResults = await dataStore.bulk({
    docs: storeRepoDocuments
  })
  checkResultsForErrors(repoResults)
}

// ---------------------------------------------------------------------
// Private
// ---------------------------------------------------------------------

// This checks for conflicts and errors in the datastore write results
const checkResultsForErrors = (results: DocumentBulkResponse[]): void =>
  results.forEach(result => {
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
