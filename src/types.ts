import {
  asBoolean,
  asEither,
  asMap,
  asNull,
  asNumber,
  asObject,
  asOptional,
  asString
} from 'cleaners'
import nano from 'nano'

// Regexes:
export const VALID_PATH_REGEX = /^(\/([^/ ]+([ ]+[^/ ]+)*)+)+\/?$/
export const VALID_REPO_ID_REGEX = /^[a-f0-9]{40}$/

// Types:

const asNanoDocument = asObject<nano.Document>({
  _id: asString,
  _rev: asString
})

export type EdgeBox = ReturnType<typeof asEdgeBox>
export const asEdgeBox = asObject({
  iv_hex: asString,
  encryptionType: asNumber,
  data_base64: asString
})

export type StoreFileTimestampMap = ReturnType<typeof asStoreFileTimestampMap>
export const asStoreFileTimestampMap = asMap(asNumber)

export interface FilePointers {
  paths: StoreFileTimestampMap
  deleted: StoreFileTimestampMap
}

// Settings Document

export type StoreSettings = ReturnType<typeof asStoreSettings>
export type StoreSettingsDocument = ReturnType<typeof asStoreSettingsDocument>
export const asStoreSettings = asObject({
  ipWhitelist: asMap(asBoolean),
  apiKeyWhitelist: asMap(asBoolean)
})
export const asStoreSettingsDocument = asObject({
  ...asNanoDocument.shape,
  ...asStoreSettings.shape
})

// Directory

export type StoreDirectory = ReturnType<typeof asStoreDirectory>
export type StoreDirectoryDocument = ReturnType<typeof asStoreDirectoryDocument>
export const asStoreDirectory = asObject({
  timestamp: asNumber,
  deleted: asStoreFileTimestampMap,
  paths: asStoreFileTimestampMap
})
export const asStoreDirectoryDocument = asObject({
  ...asNanoDocument.shape,
  ...asStoreDirectory.shape
})

// Repo

export interface StoreRepo extends StoreDirectory {
  timestamp: number
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
  ...asNanoDocument.shape,
  ...asStoreRepo.shape
})

// File

export type StoreFile = ReturnType<typeof asStoreFile>
export type StoreFileDocument = ReturnType<typeof asStoreFileDocument>
export const asStoreFile = asObject({
  timestamp: asNumber,
  box: asEdgeBox
})
export const asStoreFileDocument = asObject({
  ...asNanoDocument.shape,
  ...asStoreFile.shape
})

// Change Set

export type FileChange = ReturnType<typeof asFileChange>
export const asFileChange = asEither(asObject({ box: asEdgeBox }), asNull)

export type ChangeSet = ReturnType<typeof asChangeSet>
export const asChangeSet = asMap(asFileChange)

// Union of all store data types
export type StoreData = StoreSettings | StoreRepo | StoreDirectory | StoreFile
// Union of all document types
export type StoreDocument =
  | StoreSettingsDocument
  | StoreRepoDocument
  | StoreDirectoryDocument
  | StoreFileDocument

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

// General Purpose Cleaner Types

export function asNonEmptyString(raw: any): string {
  const str = asString(raw)

  if (str === '') {
    throw new TypeError('Expected non empty string')
  }

  return str
}

export function asPath(raw: any): string {
  const path = asString(raw)

  if (!VALID_PATH_REGEX.test(path)) {
    throw new Error(`Invalid path '${path}'`)
  }

  return path
}

export function asRepoId(raw: any): string {
  const repoId = asString(raw)

  if (!VALID_REPO_ID_REGEX.test(repoId)) {
    throw new Error(`Invalid repo ID '${repoId}'`)
  }

  return repoId
}
