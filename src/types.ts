import {
  asArray,
  asBoolean,
  asEither,
  asNull,
  asNumber,
  asObject,
  asOptional,
  asString
} from 'cleaners'

// Regexes:
export const VALID_PATH_REGEX = /^(\/([^/ ]+([ ]+[^/ ]+)*)+)+\/?$/
export const VALID_SYNC_KEY_REGEX = /^[a-f0-9]{40}$/

// Primitive Types

export const asNonEmptyString = (raw: any): string => {
  const str = asString(raw)

  if (str === '') {
    throw new TypeError('Expected non empty string')
  }

  return str
}

export const asPath = (raw: any): string => {
  const path = asString(raw)

  if (!VALID_PATH_REGEX.test(path)) {
    throw new Error(`Invalid path '${path}'`)
  }

  return path
}

export const asSyncKey = (raw: any): string => {
  const syncKey = asString(raw)

  if (!VALID_SYNC_KEY_REGEX.test(syncKey)) {
    throw new TypeError(`Invalid sync key '${syncKey}'`)
  }

  return syncKey
}

// Document Types:

const nanoDocumentShape = {
  _id: asString,
  _rev: asString
}
const storeMergeDocumentShape = {
  ...nanoDocumentShape,
  mergeBaseTimestamp: asOptional(asString)
}

export type TimestampRev = string
export const asTimestampRev = (ts: unknown): TimestampRev => {
  if (typeof ts === 'string' && /^\d{1,15}(\.\d+)?$/.test(ts)) {
    return ts
  }
  if (typeof ts === 'number') {
    return ts.toString()
  }

  throw new TypeError(`Invalid timestamp rev '${String(ts)}'`)
}

export type EdgeBox = ReturnType<typeof asEdgeBox>
export const asEdgeBox = asObject({
  iv_hex: asString,
  encryptionType: asNumber,
  data_base64: asString
})

// Also known as a "file pointer map"
export type StoreFileTimestampMap = ReturnType<typeof asStoreFileTimestampMap>
export const asStoreFileTimestampMap = asObject(asTimestampRev)

export interface FilePointers {
  paths: StoreFileTimestampMap
  deleted: StoreFileTimestampMap
}

export type TimestampHistory = ReturnType<typeof asTimestampHistory>
export const asTimestampHistory = asArray(
  asObject({
    timestamp: asTimestampRev,
    rev: asString
  })
)

// Settings Document

export type StoreSettings = ReturnType<typeof asStoreSettings>
export type StoreSettingsDocument = ReturnType<typeof asStoreSettingsDocument>
export const asStoreSettings = asObject({
  ipWhitelist: asObject(asBoolean),
  apiKeyWhitelist: asObject(asBoolean)
})
export const asStoreSettingsDocument = asObject({
  ...nanoDocumentShape,
  ...asStoreSettings.shape
})

// Directory

export type StoreDirectory = ReturnType<typeof asStoreDirectory>
export type StoreDirectoryDocument = ReturnType<typeof asStoreDirectoryDocument>
export const asStoreDirectory = asObject({
  timestamp: asTimestampRev,
  deleted: asStoreFileTimestampMap,
  paths: asStoreFileTimestampMap,
  timestampHistory: asTimestampHistory
})
export const asStoreDirectoryDocument = asObject({
  ...storeMergeDocumentShape,
  ...asStoreDirectory.shape
})

// Repo

export interface StoreRepo extends StoreDirectory {
  timestamp: TimestampRev
  lastGitHash?: string
  lastGitTime?: number
  size: number
  sizeLastCreated: number
  maxSize: number
}
export type StoreRepoDocument = ReturnType<typeof asStoreRepoDocument>
export const asStoreRepo = asObject<StoreRepo>({
  ...asStoreDirectory.shape,
  lastGitHash: asOptional(asString),
  lastGitTime: asOptional(asNumber),
  size: asNumber,
  sizeLastCreated: asNumber,
  maxSize: asNumber
})
export const asStoreRepoDocument = asObject({
  ...storeMergeDocumentShape,
  ...asStoreRepo.shape
})

// File

export type StoreFile = ReturnType<typeof asStoreFile>
export type StoreFileDocument = ReturnType<typeof asStoreFileDocument>
export const asStoreFile = asObject({
  timestamp: asTimestampRev,
  box: asEdgeBox
})
export const asStoreFileDocument = asObject({
  ...storeMergeDocumentShape,
  ...asStoreFile.shape
})

// Change Set

export type FileChange = ReturnType<typeof asFileChange>
export const asFileChange = asEither(asObject({ box: asEdgeBox }), asNull)

export type ChangeSet = ReturnType<typeof asChangeSet>
export const asChangeSet = asObject(asFileChange)

// Union of all store data types
export type StoreData = StoreSettings | StoreRepo | StoreDirectory | StoreFile
// Union of all document types
export type StoreDocument =
  | StoreSettingsDocument
  | StoreRepoDocument
  | StoreDirectoryDocument
  | StoreFileDocument

// API Types:

export type StoreFileWithTimestamp = ReturnType<typeof asStoreFileWithTimestamp>
export const asStoreFileWithTimestamp = asObject({
  ...asStoreFile.shape,
  timestamp: asTimestampRev
})

export type StoreDirectoryPathWithTimestamp = ReturnType<
  typeof asStoreDirectoryPathWithTimestamp
>
export const asStoreDirectoryPathWithTimestamp = asObject({
  paths: asStoreFileTimestampMap,
  timestamp: asTimestampRev
})

export type GetFilesMap = ReturnType<typeof asGetFilesMap>
export const asGetFilesMap = asObject(
  asEither(asStoreFileWithTimestamp, asStoreDirectoryPathWithTimestamp)
)

// API Responses

export interface ApiResponse<Data> {
  success: true
  data: Data
}
export interface ApiErrorResponse {
  success: false
  message: string
  error?: string
}
export class ApiClientError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// V3

export type ConfigGetResponse = ReturnType<typeof asConfigGetResponse>
export const asConfigGetResponse = asObject({
  maxPageSize: asNumber
})

export type GetFilesBody = ReturnType<typeof asGetFilesBody>
export const asGetFilesBody = asObject({
  syncKey: asSyncKey,
  ignoreTimestamps: asOptional(asBoolean),
  paths: asStoreFileTimestampMap
})
export type GetFilesResponse = ReturnType<typeof asGetFilesResponse>
export const asGetFilesResponse = asObject({
  total: asNumber,
  paths: asGetFilesMap
})

export type GetUpdatesBody = ReturnType<typeof asGetUpdatesBody>
export const asGetUpdatesBody = asObject({
  syncKey: asSyncKey,
  timestamp: asTimestampRev
})
export type GetUpdatesResponse = ReturnType<typeof asGetUpdatesResponse>
export const asGetUpdatesResponse = asObject({
  timestamp: asTimestampRev,
  paths: asStoreFileTimestampMap,
  deleted: asStoreFileTimestampMap
})

export type PutRepoBody = ReturnType<typeof asPutRepoBody>
export const asPutRepoBody = asObject({
  syncKey: asSyncKey
})
export type PutRepoResponse = ReturnType<typeof asPutRepoResponse>
export const asPutRepoResponse = asObject({
  timestamp: asTimestampRev
})

export type UpdateFilesBody = ReturnType<typeof asUpdateFilesBody>
export const asUpdateFilesBody = asObject({
  syncKey: asSyncKey,
  timestamp: asTimestampRev,
  paths: asChangeSet
})
export type UpdateFilesResponse = ReturnType<typeof asUpdateFilesResponse>
export const asUpdateFilesResponse = asObject({
  timestamp: asTimestampRev,
  paths: asStoreFileTimestampMap
})

// V2

export * from './v2/types'
