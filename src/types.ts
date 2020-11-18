import { asMap, asNumber, asObject, asOptional, asString } from 'cleaners'
import * as Nano from 'nano'

// Is there a better way to make optional properties for this type?
const asNanoMaybeDocument = asObject<Nano.MaybeDocument>({
  _id: asOptional(asString),
  _rev: asOptional(asString)
})

export type StoreFileMap = ReturnType<typeof asStoreFileMap>
export const asStoreFileMap = asMap(asNumber)

// Directory

export type StoreDirectory = ReturnType<typeof asStoreDirectory>
export type StoreDirectoryDocument = ReturnType<typeof asStoreDirectoryDocument>
export const asStoreDirectory = asObject({
  deleted: asStoreFileMap,
  paths: asStoreFileMap
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
  text: asString
})
export const asStoreFileDocument = asObject({
  ...asNanoMaybeDocument.shape,
  ...asStoreFile.shape
})

export interface DocumentRequest {
  [Key: string]: number
}

export interface Results {
  [Key: string]: StoreDocument
}

export interface StoreDocument {
  timestamp: number
  files?: object
  content?: string
}

export type DbResponse = Nano.DocumentGetResponse & StoreDocument

export interface File {
  timestamp: number
  content: string
}

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
