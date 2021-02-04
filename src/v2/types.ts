import {
  asEither,
  asMap,
  asNull,
  asObject,
  asOptional,
  asString
} from 'cleaners'

import { asEdgeBox, asNonEmptyString, asRepoId, asTimestampRev } from '../types'

export type FileChangeV2 = ReturnType<typeof asFileChangeV2>
export const asFileChangeV2 = asEither(asEdgeBox, asNull)

export type ChangeSetV2 = ReturnType<typeof asChangeSetV2>
export const asChangeSetV2 = asMap(asFileChangeV2)

export type GetStoreParams = ReturnType<typeof asGetStoreParams>
export const asGetStoreParams = asObject({
  storeId: asRepoId,
  hash: asOptional(asNonEmptyString)
})
export type GetStoreResponse = ReturnType<typeof asGetStoreResponse>
export const asGetStoreResponse = asObject({
  hash: asString,
  changes: asChangeSetV2
})

export type PostStoreParams = ReturnType<typeof asPostStoreParams>
export const asPostStoreParams = asObject({
  storeId: asRepoId,
  hash: asOptional(asNonEmptyString)
})
export type PostStoreBody = ReturnType<typeof asPostStoreBody>
export const asPostStoreBody = asObject({
  changes: asChangeSetV2
})
export type PostStoreResponse = ReturnType<typeof asPostStoreResponse>
export const asPostStoreResponse = asObject({
  hash: asString,
  changes: asChangeSetV2
})

export type PutStoreParams = ReturnType<typeof asPutStoreParams>
export const asPutStoreParams = asObject({
  storeId: asRepoId
})
export type PutStoreResponse = ReturnType<typeof asPutStoreResponse>
export const asPutStoreResponse = asObject({
  timestamp: asTimestampRev
})
