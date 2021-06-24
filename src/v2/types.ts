import {
  asEither,
  asNull,
  asObject,
  asOptional,
  asString,
  asUndefined
} from 'cleaners'

import { asEdgeBox, asNonEmptyString, asSyncKey } from '../types'

export type FileChangeV2 = ReturnType<typeof asFileChangeV2>
export const asFileChangeV2 = asEither(asEdgeBox, asNull)

export type ChangeSetV2 = ReturnType<typeof asChangeSetV2>
export const asChangeSetV2 = asObject(asFileChangeV2)

export type GetStoreParams = ReturnType<typeof asGetStoreParams>
export const asGetStoreParams = asObject({
  syncKey: asSyncKey,
  hash: asOptional(asNonEmptyString)
})
export type GetStoreResponse = ReturnType<typeof asGetStoreResponse>
export const asGetStoreResponse = asObject({
  hash: asString,
  changes: asChangeSetV2
})

export type PostStoreParams = ReturnType<typeof asPostStoreParams>
export const asPostStoreParams = asObject({
  syncKey: asSyncKey,
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
  syncKey: asSyncKey
})
export type PutStoreResponse = ReturnType<typeof asPutStoreResponse>
export const asPutStoreResponse = asUndefined
