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
import nano from 'nano'

import { asEdgeBox } from './primitive-types'

const nanoDocumentShape = {
  _id: asString,
  _rev: asString
}

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

// Repo

export interface StoreRepo {
  timestamp: number
  lastGitHash?: string
  lastGitTime?: number
  size: number
  sizeLastCreated: number
  maxSize: number
}
export type StoreRepoDocument = ReturnType<typeof asStoreRepoDocument>
export const asStoreRepo = asObject<StoreRepo>({
  timestamp: asNumber,
  lastGitHash: asOptional(asString),
  lastGitTime: asOptional(asNumber),
  size: asNumber,
  sizeLastCreated: asNumber,
  maxSize: asNumber
})
export const asStoreRepoDocument = asObject({
  ...nanoDocumentShape,
  ...asStoreRepo.shape
})

// File

export type StoreFile = ReturnType<typeof asStoreFile>
export type StoreFileDocument = ReturnType<typeof asStoreFileDocument>
export const asStoreFile = asObject({
  timestamp: asNumber,
  box: asEither(asEdgeBox, asNull),
  versions: asArray(asNumber)
})
export const asStoreFileDocument = asObject({
  ...nanoDocumentShape,
  ...asStoreFile.shape
})

// Deleted Document (for conflict resolution)
export type DeletedDocument = nano.Document & { _deleted: true }

// Union of all store data types
export type StoreData = StoreSettings | StoreRepo | StoreFile
// Union of all document types
export type StoreDocument =
  | StoreSettingsDocument
  | StoreRepoDocument
  | StoreFileDocument
  | DeletedDocument
