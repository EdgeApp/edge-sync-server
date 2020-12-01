import {
  asEither,
  asMap,
  asNull,
  asNumber,
  asObject,
  asOptional,
  asString
} from 'cleaners'
import * as Nano from 'nano'

// Regexes:
export const VALID_PATH_REGEX = /^(\/([^/ ]+([ ]+[^/ ]+)*)+)+\/?$/

// Types:

// Is there a better way to make optional properties for this type?
const asNanoMaybeDocument = asObject<Nano.MaybeDocument>({
  _id: asOptional(asString),
  _rev: asOptional(asString)
})

export type EdgeBox = ReturnType<typeof asEdgeBox>
export const asEdgeBox = asObject({
  iv_hex: asString,
  encryptionType: asNumber,
  data_base64: asString
})

export type StoreFileTimestampMap = ReturnType<typeof asStoreFileTimestampMap>
export const asStoreFileTimestampMap = asMap(asNumber)

// Directory

export type StoreDirectory = ReturnType<typeof asStoreDirectory>
export type StoreDirectoryDocument = ReturnType<typeof asStoreDirectoryDocument>
export const asStoreDirectory = asObject({
  deleted: asStoreFileTimestampMap,
  paths: asStoreFileTimestampMap
})
export const asStoreDirectoryDocument = asObject({
  ...asNanoMaybeDocument.shape,
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
  timestamp: asNumber,
  lastGitHash: asOptional(asString),
  lastGitTime: asOptional(asNumber),
  size: asNumber,
  sizeLastCreated: asNumber,
  maxSize: asNumber
})
export const asStoreRepoDocument = asObject({
  ...asNanoMaybeDocument.shape,
  ...asStoreRepo.shape
})

// File

export type StoreFile = ReturnType<typeof asStoreFile>
export type StoreFileDocument = ReturnType<typeof asStoreFileDocument>
export const asStoreFile = asObject({
  box: asEdgeBox
})
export const asStoreFileDocument = asObject({
  ...asNanoMaybeDocument.shape,
  ...asStoreFile.shape
})

// Change Set

export type FileChange = ReturnType<typeof asFileChange>
export const asFileChange = asEither(asStoreFile, asNull)

export type ChangeSet = ReturnType<typeof asChangeSet>
export const asChangeSet = asMap(asFileChange)

// Union of all document types
export type StoreDocument = StoreRepo | StoreDirectory | StoreFile

// API Responses

export interface ApiResponse<Data> {
  success: true
  data: Data
}
export interface ApiErrorResponse {
  success: false
  message: string
}

export type ApiClientError = ReturnType<typeof asApiClientError>
export const asApiClientError = asObject({
  status: asNumber,
  message: asString
})

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
