import { asMaybe } from 'cleaners'
import nano from 'nano'

import { AppState } from '../server'
import {
  asStoreDirectoryDocument,
  asStoreFileDocument,
  asStoreRepoDocument,
  StoreDirectoryDocument,
  StoreDocument
} from '../types'
import { mergeFilePointers } from '../util/utils'

type ConflictFreeResult = ConflictFreeResultDoc | ConflictFreeResultError
interface ConflictFreeResultDoc {
  key: string
  doc: StoreDocument
}
interface ConflictFreeResultError {
  key: string
  error: BulkGetError
}

interface BulkGetResponse {
  results: BulkGetResult[]
}
interface BulkGetResult {
  id: string
  docs: Array<BulkGetResultDoc | BulkGetResultError>
}
interface BulkGetResultDoc {
  ok: StoreDocument
}
interface BulkGetResultError {
  error: BulkGetError
}
interface BulkGetError extends Error {
  id: string
  rev: string
  error: string
  reason: string
}

export const getConflictFreeDocuments = ({
  config,
  dbServer
}: AppState) => async (keys: string[]): Promise<ConflictFreeResult[]> => {
  const docs = keys.map(key => ({ id: key, key: key }))
  const response: BulkGetResponse = await dbServer.request({
    db: config.couchDatabase,
    method: 'post',
    path: '_bulk_get',
    body: { docs }
  })

  return response.results.map(resolveDocumentConflicts)
}

export const resolveDocumentConflicts = (
  result: BulkGetResult
): ConflictFreeResult => {
  let cfResult: ConflictFreeResult

  if (result.docs.length > 1) {
    // Cast result.docs. This excludes the error type.
    const resultDocs = result.docs as BulkGetResultDoc[]

    const doc: StoreDocument = resultDocs
      .map(({ ok: doc }) => doc)
      .reduce(
        (leftDoc, rightDoc): StoreDocument => {
          const leftFileDoc = asMaybe(asStoreFileDocument)(leftDoc)
          const rightFileDoc = asMaybe(asStoreFileDocument)(rightDoc)

          // Merge file documents
          if (leftFileDoc != null && rightFileDoc != null) {
            return sortTimestampedDoc(leftFileDoc, rightFileDoc)[1]
          }

          const leftRepoDoc = asMaybe(asStoreRepoDocument)(leftDoc)
          const leftDirectoryDoc = asMaybe(asStoreDirectoryDocument)(leftDoc)
          const leftDirectoryLikeDoc = leftRepoDoc ?? leftDirectoryDoc
          const rightRepoDoc = asMaybe(asStoreRepoDocument)(rightDoc)
          const rightDirectoryDoc = asMaybe(asStoreDirectoryDocument)(rightDoc)
          const rightDirectoryLikeDoc = rightRepoDoc ?? rightDirectoryDoc

          // Merge directory-like documents
          if (leftDirectoryLikeDoc != null && rightDirectoryLikeDoc != null) {
            return mergeDirectoryLikeDoc(
              leftDirectoryLikeDoc,
              rightDirectoryLikeDoc
            )
          }

          // Documents aren't of the same type
          if (rightFileDoc != null && leftDirectoryLikeDoc != null) {
            return sortTimestampedDoc(rightFileDoc, leftDirectoryLikeDoc)[1]
          }
          if (leftFileDoc != null && rightDirectoryLikeDoc != null) {
            return sortTimestampedDoc(leftFileDoc, rightDirectoryLikeDoc)[1]
          }

          // Unknown document types:
          throw new Error(
            'Unable to merge conlficts for documents of unknown type.'
          )
        }
      )

    cfResult = {
      key: result.id,
      doc
    }
  } else {
    cfResult =
      'ok' in result.docs[0]
        ? { key: result.id, doc: result.docs[0].ok }
        : { key: result.id, error: result.docs[0].error }
  }

  return cfResult
}

export const mergeDirectoryLikeDoc = <T extends StoreDirectoryDocument>(
  left: T,
  right: T
): T => {
  ;[left, right] = sortTimestampedDoc(left, right)

  return { ...left, ...right, ...mergeFilePointers(left, right) }
}

export const sortTimestampedDoc = <
  A extends { timestamp: number } & nano.Document,
  B extends { timestamp: number } & nano.Document
>(
  left: A,
  right: B
): Array<A | B> => {
  if (left.timestamp > right.timestamp) {
    return [right, left]
  } else if (right.timestamp > left.timestamp) {
    return [left, right]
  } else if (left._rev > right._rev) {
    return [right, left]
  } else {
    return [left, right]
  }
}
