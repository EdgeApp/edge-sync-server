import { asEither, asMap, asNull, asNumber, asObject, asString } from 'cleaners'
import Router from 'express-promise-router'
import { DocumentBulkResponse } from 'nano'

import { dataStore } from '../db'
import {
  ApiResponse,
  asStoreDirectoryDocument,
  asStoreFile,
  asStoreFileDocument,
  asStoreRepoDocument,
  StoreDirectory,
  StoreDirectoryDocument,
  StoreFile,
  StoreFileDocument,
  StoreRepoDocument
} from '../types'
import {
  getNameFromPath,
  getParentPathsOfPath,
  makeApiClientError,
  mergeDirectoryFilePointers,
  updateDirectoryFilePointers
} from '../utils'

type UpdateFilesBody = ReturnType<typeof asUpdateFilesBody>
const asUpdateFilesBody = asObject({
  timestamp: asNumber,
  repoId: asString,
  paths: asMap(asEither(asStoreFile, asNull))
})

interface UpdateFilesResponseData {
  timestamp: number
  paths: {
    [path: string]: number
  }
}

const VALID_PATH_REGEX = /^(\/([^/ ]+([ ]+[^/ ]+)*)+)+\/?$/

export const updateFilesRouter = Router()

updateFilesRouter.post('/updateFiles', async (req, res) => {
  let body: UpdateFilesBody
  let paths: string[]
  let fileKeys: string[]
  let repoId: string
  let repoKey: string

  // Validate request body
  try {
    body = asUpdateFilesBody(req.body)
    repoId = body.repoId
    repoKey = `${repoId}:/`

    if (repoId === '') {
      throw new Error(`Missing repoId.`)
    }

    paths = Object.keys(body.paths)

    // Validate paths are formated correctly
    paths.forEach(path => {
      if (path === '/') {
        throw new Error(`Invalid path '${path}'. Path cannot be root.`)
      }
      if (!VALID_PATH_REGEX.test(path)) {
        throw new Error(`Invalid path '${path}'`)
      }
    })

    fileKeys = paths.map(path => `${repoId}:${path}`)
  } catch (error) {
    throw makeApiClientError(400, error.message)
  }

  // Validate request body timestamp
  let repoDoc: StoreRepoDocument
  try {
    const repoQuery = await dataStore.get(repoKey)
    repoDoc = asStoreRepoDocument(repoQuery)
  } catch (err) {
    throw new Error(`Failed to validate repo: ${err.message}`)
  }

  if (repoDoc.timestamp !== body.timestamp) {
    throw makeApiClientError(422, `Failed due to out-of-date timestamp`)
  }

  // Timestamp is the same for all updates for this request
  let requestTimestamp = Date.now()
  let retries: number = 0

  while (true) {
    try {
      if (retries < 100) {
        await filesUpdateRoutine(body, repoKey, fileKeys, requestTimestamp)
      } else {
        throw new Error(`Failed to resolve conflicts after ${retries} attempts`)
      }
    } catch (err) {
      if (err.message === 'conflict') {
        requestTimestamp = Date.now()
        retries += 1
        continue
      } else {
        throw err
      }
    }

    break
  }

  // Response:

  const responseData: UpdateFilesResponseData = {
    timestamp: requestTimestamp,
    paths: paths.reduce((paths, path) => {
      paths[path] = requestTimestamp
      return paths
    }, {})
  }

  const response: ApiResponse<UpdateFilesResponseData> = {
    success: true,
    data: responseData
  }
  res.status(200).json(response)
})

const filesUpdateRoutine = async (
  body: UpdateFilesBody,
  repoKey: string,
  fileKeys: string[],
  requestTimestamp: number
): Promise<void> => {
  // Prepare Files Documents:

  const fileRevsResult = await dataStore.fetch({ keys: fileKeys })
  const storeFileDocuments: StoreFileDocument[] = []
  const directoryModifications: Map<string, StoreDirectory> = new Map()
  let repoModification: Pick<
    StoreRepoDocument,
    'paths' | 'deleted' | 'timestamp'
  > = { paths: {}, deleted: {}, timestamp: 0 }

  // Prepare file documents:
  fileRevsResult.rows.forEach(row => {
    const fileKey = row.key
    const [repoId, filePath] = fileKey.split(':')
    const storeFile: StoreFile = body.paths[filePath] ?? { text: '' }
    const isDeletion = body.paths[filePath] === null

    if (!isDeletion) {
      if ('doc' in row) {
        try {
          asStoreFileDocument(row.doc)
        } catch (err) {
          throw makeApiClientError(
            422,
            `Unable to write file '${fileKey}'. ` +
              `Existing document is not a file.`
          )
        }

        // Document will be overwritten
        storeFileDocuments.push({
          ...storeFile,
          _id: fileKey,
          _rev: row.value.rev
        })
      } else {
        // Document will be inserted
        storeFileDocuments.push({ ...storeFile, _id: fileKey })
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
        requestTimestamp,
        // Only delete if file pointer is the file (don't delete directories)
        filePointerPath === fileName && isDeletion
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
        requestTimestamp,
        // Only delete if file pointer is the file (don't delete directories)
        filePointerPath === fileName && isDeletion
      ),
      timestamp: requestTimestamp
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
      const directoryModification = directoryModifications.get(directoryKey)

      if (directoryModification !== undefined) {
        if ('doc' in row) {
          let existingDirectory: StoreDirectoryDocument

          try {
            existingDirectory = asStoreDirectoryDocument(row.doc)
          } catch (err) {
            throw makeApiClientError(
              422,
              `Unable to write files under '${directoryKey}'. ` +
                `Existing document is not a directory.`
            )
          }

          const directoryDocument: StoreDirectoryDocument = mergeDirectoryFilePointers(
            existingDirectory,
            directoryModification
          )

          // Update document
          storeDirectoryDocuments.push(directoryDocument)
        } else {
          // Insert document
          storeDirectoryDocuments.push({
            ...directoryModification,
            _id: directoryKey
          })
        }
      }
    })
  }

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

  // Writes:

  // Write Files and Directories
  const fileAndDirResults = await dataStore.bulk({
    docs: [...storeFileDocuments, ...storeDirectoryDocuments]
  })
  checkResultsForErrors(fileAndDirResults)

  // Write Repos
  const repoResults = await dataStore.bulk({
    docs: storeRepoDocuments
  })
  checkResultsForErrors(repoResults)
}

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
