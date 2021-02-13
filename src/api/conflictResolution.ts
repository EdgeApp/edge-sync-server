import { add, div, gt, lt, mul, sub } from 'biggystring'
import { asMaybe } from 'cleaners'
import nano from 'nano'

import { AppState } from '../server'
import {
  asStoreDirectoryDocument,
  asStoreFileDocument,
  asStoreRepoDocument,
  asTimestampRev,
  StoreDirectoryDocument,
  StoreDocument,
  TimestampHistory,
  TimestampRev
} from '../types'
import { maxAll } from '../util/math'
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

interface ConflictDocumentSet {
  id: string
  docs: Array<BulkGetResultDoc | BulkGetResultError>
  mergeBaseTimestamp?: TimestampRev
}

// _bulk_get response type information
interface BulkGetResponse {
  results: BulkGetResult[]
}
interface BulkGetResult {
  id: string
  docs: Array<BulkGetResultDoc | BulkGetResultError>
}
interface BulkGetResultDoc {
  ok: BulkGetDoc
}
type BulkGetDoc = StoreDocument

interface BulkGetResultError {
  error: BulkGetError
}
interface BulkGetError extends Error {
  id: string
  rev: string
  error: string
  reason: string
}

const SUB_VERSION_LENGTH = 16
const SUB_VERSION_FACTOR = '1' + '0'.padEnd(SUB_VERSION_LENGTH, '0')

export const getConflictFreeDocuments = ({
  config,
  dbServer
}: AppState) => async (keys: string[]): Promise<ConflictFreeResult[]> => {
  const docs = keys.map(key => ({ id: key }))
  const response: BulkGetResponse = await dbServer.request({
    db: config.couchDatabase,
    method: 'post',
    path: '_bulk_get',
    body: { docs }
  })

  // Filter out deleted type documents from result set. A deleted document
  // means the conflicting branch has previously been resolved.
  const results = filterDeletedDocsFromResults(response.results)

  /*
  Get the merge base timestamps for each conflicting document.
  The merge base timestamp is the timestamp for the document from which all 
  conflicts have forked fork. The merge base should be the latest shared item in
  the timestampHistory between all of the conflicting documents.
  */
  const mergeBaseTimestampMap = results.reduce<{
    [docId: string]: TimestampRev
  }>((map, result) => {
    const docId = result.id

    // Skip for any document retrieval errors.
    // Errors should be handled at the call-site of this API function.
    if ('error' in result.docs[0]) {
      return map
    }

    const sharedTimestampHistory = result.docs
      .slice(1)
      .reduce<TimestampHistory>((sharedTimestampHistory, resultDoc) => {
        if ('ok' in resultDoc) {
          const timestampHistory = timestampHistoryFromBulkGetResultDoc(
            resultDoc
          )
          sharedTimestampHistory = intersectTimestampHistory(
            sharedTimestampHistory,
            timestampHistory
          )
        }
        return sharedTimestampHistory
      }, timestampHistoryFromBulkGetResultDoc(result.docs[0]))

    map[docId] = sharedTimestampHistory[0]?.timestamp

    return map
  }, {})

  // Create a conflict document set to contain all the document conflict results
  // and the merge base timestamp.
  const conflictDocumentSet = results.map(
    (result): ConflictDocumentSet => ({
      id: result.id,
      docs: result.docs,
      mergeBaseTimestamp: mergeBaseTimestampMap[result.id]
    })
  )

  // Resolve all conflicts sets by mapping over the conflict resolution function
  const resolvedDocuments = conflictDocumentSet.map(resolveDocumentConflicts)

  return resolvedDocuments
}

export const resolveDocumentConflicts = (
  conflictDocumentSet: ConflictDocumentSet
): ConflictFreeResult => {
  const { id: documentId, mergeBaseTimestamp } = conflictDocumentSet
  let conflictFreeResult: ConflictFreeResult

  // There are no conflicts or there's an error if only one document in the set
  if (conflictDocumentSet.docs.length === 1) {
    conflictFreeResult =
      'ok' in conflictDocumentSet.docs[0]
        ? { key: documentId, doc: conflictDocumentSet.docs[0].ok }
        : {
            key: documentId,
            error: conflictDocumentSet.docs[0].error
          }
    return conflictFreeResult
  }

  // Cast result.docs. This excludes the error type.
  // We can exclude the error type because the length of the docs array is > 1
  const resultDocs = conflictDocumentSet.docs as BulkGetResultDoc[]

  const docs = resultDocs.map(({ ok: doc }) => ({ ...doc, mergeBaseTimestamp }))

  // Merge the documents
  const doc = docs.slice(1).reduce<StoreDocument>((leftDoc, rightDoc) => {
    const leftFileDoc = asMaybe(asStoreFileDocument)(leftDoc)
    const rightFileDoc = asMaybe(asStoreFileDocument)(rightDoc)

    // Merge file documents
    if (leftFileDoc != null && rightFileDoc != null) {
      const mergedDoc = mergeTimestampedDocs(leftFileDoc, rightFileDoc)

      return mergedDoc
    }

    const leftRepoDoc = asMaybe(asStoreRepoDocument)(leftDoc)
    const leftDirectoryDoc = asMaybe(asStoreDirectoryDocument)(leftDoc)
    const leftDirectoryLikeDoc = leftRepoDoc ?? leftDirectoryDoc
    const rightRepoDoc = asMaybe(asStoreRepoDocument)(rightDoc)
    const rightDirectoryDoc = asMaybe(asStoreDirectoryDocument)(rightDoc)
    const rightDirectoryLikeDoc = rightRepoDoc ?? rightDirectoryDoc

    // Merge directory-like documents
    if (leftDirectoryLikeDoc != null && rightDirectoryLikeDoc != null) {
      return mergeDirectoryLikeDocs(
        leftDirectoryLikeDoc,
        rightDirectoryLikeDoc,
        mergeBaseTimestamp
      )
    }

    // Documents aren't of the same type
    const fileDoc = leftFileDoc ?? rightFileDoc
    const directoryLikeDocument = leftDirectoryLikeDoc ?? rightDirectoryLikeDoc
    if (fileDoc != null && directoryLikeDocument != null) {
      return mergeTimestampedDocs(fileDoc, directoryLikeDocument)
    }

    // Assert that there should be no deleted documents while resolving conflicts
    if ('_deleted' in leftDoc || '_deleted' in rightDoc) {
      throw new Error(`Unexpected deleted document in conflict resolution`)
    }

    // Unknown document types
    throw new Error('Unable to merge conflicts for documents of unknown type.')
  }, docs[0])

  conflictFreeResult = {
    key: documentId,
    doc
  }

  return conflictFreeResult
}

export const mergeDirectoryLikeDocs = <T extends StoreDirectoryDocument>(
  left: T,
  right: T,
  mergeBaseTimestamp?: TimestampRev
): T => {
  const [losing, winning] = sortTimestampedDoc(left, right)

  // Add losing timestamp as a sub-version value to winning timestamp
  const mergedTimestampRev = add(
    winning.timestamp,
    timestampSubVersion([losing.timestamp])
  )

  return {
    ...winning,
    // Include the timestamp
    timestamp: mergedTimestampRev,
    // Include the merged file pointers
    ...mergeFilePointers(losing, winning, mergeBaseTimestamp)
  }
}

export const mergeTimestampedDocs = <
  A extends { timestamp: TimestampRev } & nano.Document,
  B extends { timestamp: TimestampRev } & nano.Document
>(
  left: A,
  right: B
): A | B => {
  const [losing, winning] = sortTimestampedDoc(left, right)

  // Add losing timestamp as a sub-version value to winning timestamp
  const mergedTimestampRev = add(
    winning.timestamp,
    timestampSubVersion([losing.timestamp])
  )

  return { ...winning, timestamp: mergedTimestampRev }
}

// Sorts two documents with timestamp fields in ascending order
export const sortTimestampedDoc = <
  A extends { timestamp: TimestampRev } & nano.Document,
  B extends { timestamp: TimestampRev } & nano.Document
>(
  left: A,
  right: B
): [A | B, A | B] => {
  if (gt(left.timestamp, right.timestamp)) {
    return [right, left]
  } else if (gt(right.timestamp, left.timestamp)) {
    return [left, right]
  } else if (gt(left._rev, right._rev)) {
    return [right, left]
  } else {
    return [left, right]
  }
}

export const timestampSubVersion = (timestampRevs: TimestampRev[]): string => {
  // The sub-version is the sum of all conflicting timestamps
  const subVersion = timestampRevs
    .map(timestampRev =>
      timestampRev
        .split('.')
        .reduce((major, minor) =>
          add(major, mul(`.${minor}`, SUB_VERSION_FACTOR))
        )
    )
    .reduce((subVersion, timestamp) => add(subVersion, timestamp), '0')

  return div(subVersion, SUB_VERSION_FACTOR, SUB_VERSION_LENGTH)
}

/**
 * Creates a new TimestampHistory given an optional StoreDirectoryDocument.
 * If no StoreDirectoryDocument is provided, an empty TimestampHistory is
 * returned. Otherwise, it'll include all the document's timestampHistory that
 * doesn't exceed the maxAge.
 *
 * @param maxAge Maximum number of milleseconds from the timestamp to now
 * @param dirLikeDoc Optional directory like document to include in the
 * timestamp history.
 */
export const makeTimestampHistory = (
  maxAge: number,
  dirLikeDoc?: StoreDirectoryDocument
): TimestampHistory => {
  const currentTimestamp = asTimestampRev(Date.now())

  return dirLikeDoc != null
    ? [
        {
          timestamp: dirLikeDoc.timestamp,
          rev: dirLikeDoc._rev
        },
        ...dirLikeDoc.timestampHistory
      ].filter(({ timestamp }) =>
        lt(sub(currentTimestamp, timestamp), maxAge.toString())
      )
    : []
}

export const intersectTimestampHistory = (
  lefts: TimestampHistory,
  rights: TimestampHistory
): TimestampHistory =>
  lefts.filter(left =>
    rights.some(
      right => left.timestamp === right.timestamp && left.rev === right.rev
    )
  )

export const timestampHistoryFromBulkGetResultDoc = (
  resultDoc: BulkGetResultDoc
): TimestampHistory => {
  return 'timestampHistory' in resultDoc.ok ? resultDoc.ok.timestampHistory : []
}

export const deleteLosingConflictingDocuments = ({
  config,
  dataStore,
  dbServer
}: AppState) => async (keys: string[]): Promise<void> => {
  const docs = keys.map(key => ({ id: key }))

  const response: BulkGetResponse = await dbServer.request({
    db: config.couchDatabase,
    method: 'post',
    path: '_bulk_get',
    qs: {
      revs: true
    },
    body: { docs }
  })

  const results = filterDeletedDocsFromResults(response.results)

  // Generate the docs to delete for the bulk request
  const deletedDocs = results.reduce<
    Array<{ _id: string; _rev: string; _deleted: true }>
  >((docs, result) => {
    const revMap = result.docs.reduce<{
      [timestamp: string]: string
    }>((revMap, doc) => {
      if ('error' in doc && doc.error.error !== 'not_found') {
        throw new Error(
          `Failed to delete losing conflicting document '${result.id}'`
        )
      }

      if ('ok' in doc) {
        const timestampedDoc = doc.ok
        if ('timestamp' in timestampedDoc) {
          revMap[timestampedDoc.timestamp] = timestampedDoc._rev
        }
      }

      return revMap
    }, {})

    const greatestTimestamp = maxAll(...Object.keys(revMap))
    const winningRev = revMap[greatestTimestamp]

    const deletedDocs = Object.values(revMap)
      .filter(rev => rev !== winningRev)
      .map(rev => ({ _id: result.id, _rev: rev, _deleted: true as const }))

    return [...docs, ...deletedDocs]
  }, [])

  await dataStore.bulk({ docs: deletedDocs })
}

function filterDeletedDocsFromResults(
  results: BulkGetResult[]
): BulkGetResult[] {
  return results.map(result => ({
    ...result,
    docs: result.docs.filter(doc => {
      return 'ok' in doc ? !('_deleted' in doc.ok) : true
    })
  }))
}
