import { asEither, asMap, asNull, asNumber, asObject, asString } from 'cleaners'
import Router from 'express-promise-router'
import { DocumentBulkResponse } from 'nano'

import { dataStore } from '../db'
import {
  ApiErrorResponse,
  ApiResponse,
  asStoreDirectoryDocument,
  asStoreFile,
  asStoreFileDocument,
  asStoreRootDocument,
  DocumentRequest,
  Results,
  StoreDirectory,
  StoreDirectoryDocument,
  StoreFile,
  StoreFileDocument,
  StoreRootDocument
} from '../types'
import {
  getNameFromPath,
  getParentPathsOfPath,
  makeApiClientError,
  mergeDirectoryFilePointers,
  updateDirectoryFilePointers
} from '../utils'

type FilesPostBody = ReturnType<typeof asFilesPostBody>
const asFilesPostBody = asObject({
  timestamp: asNumber,
  repoId: asString,
  paths: asMap(asEither(asStoreFile, asNull))
})

interface FilesPostResponseData {
  timestamp: number
  paths: {
    [path: string]: number
  }
}

const VALID_PATH_REGEX = /^(\/([^/ ]+([ ]+[^/ ]+)*)+)+\/?$/

export const filesRouter = Router()

// ---------------------------------------------------------------------
// POST /files
// ---------------------------------------------------------------------

filesRouter.post('/files', async (req, res) => {
  let body: FilesPostBody
  let paths: string[]
  let fileKeys: string[]
  let repoId: string
  let repoKey: string

  // Validate request body
  try {
    body = asFilesPostBody(req.body)
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
  let repoDoc: StoreRootDocument
  try {
    const repoQuery = await dataStore.get(repoKey)
    repoDoc = asStoreRootDocument(repoQuery)
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

  const responseData: FilesPostResponseData = {
    timestamp: requestTimestamp,
    paths: paths.reduce((paths, path) => {
      paths[path] = requestTimestamp
      return paths
    }, {})
  }

  const response: ApiResponse<FilesPostResponseData> = {
    success: true,
    data: responseData
  }
  res.status(200).json(response)
})

const filesUpdateRoutine = async (
  body: FilesPostBody,
  repoKey: string,
  fileKeys: string[],
  requestTimestamp: number
): Promise<void> => {
  // Prepare Files Documents:

  const fileRevsResult = await dataStore.fetch({ keys: fileKeys })
  const storeFileDocuments: StoreFileDocument[] = []
  const directoryModifications: Map<string, StoreDirectory> = new Map()
  let repoModification: Pick<
    StoreRootDocument,
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
    // file pointer path because it's the direct decendent from the root.
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
  const storeRepoDocuments: StoreRootDocument[] = []

  // Prepare repo (root) documents
  repoFetchResult.rows.forEach(row => {
    const repoKey = row.key

    if ('doc' in row) {
      let existingRepo: StoreRootDocument

      try {
        existingRepo = asStoreRootDocument(row.doc)
      } catch (err) {
        throw makeApiClientError(
          422,
          `Unable to write files under '${repoKey}'. ` +
            `Document is not a repo.`
        )
      }

      const repoDocument: StoreRootDocument = mergeDirectoryFilePointers(
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

// ---------------------------------------------------------------------
// GET /files
// ---------------------------------------------------------------------

filesRouter.get('/files', async (req, res, next) => {
  const paths: DocumentRequest = JSON.parse(req.query.paths)
  console.log(paths)
  const contents: Results = {}
  const keys: string[] = Object.keys(paths)
  for (let i = 0; i < keys.length; ++i) {
    // const path = keys[i]
    try {
      /*
			const query: DbResponse = await dataStore.get(path)
			if (query.timestamp > paths[path]) {
				contents[path] = query
			}
			*/
    } catch (e) {
      console.log(e)
      const result: ApiErrorResponse = {
        success: false,
        message: 'Internal server error'
      }
      res.status(500).json(result)
    }
  }
  const result: ApiResponse<Results> = {
    success: true,
    data: contents
  }
  res.status(200).json(result)
})
