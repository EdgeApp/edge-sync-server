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
} from '../types/old-types'
import { mergeFilePointers } from '../util/utils'

// External Conflict Resolution Result Types:

type ConflictFreeResult = ConflictFreeResultDoc | ConflictFreeResultError
interface ConflictFreeResultDoc {
  key: string
  doc: StoreDocument
  conflicts: Array<{ _id: string; _rev: string }>
}
class ConflictFreeResultError extends Error {
  key: string
  error: string

  constructor(error: string, key: string) {
    super(`Document lookup failure for '${key}': ${error}`)
    this.key = key
    this.error = error
  }
}

// Internal Conflict Resolution Types:

interface ConflictDocumentSet {
  id: string
  docs: DocOrFailure[]
  mergeBaseTimestamp?: TimestampRev
}

type DocOrFailure = StoreDocument | nano.DocumentLookupFailure
type StoreDocumentWithConflicts = StoreDocument & { _conflicts?: string[] }

interface DocsOrFailuresMap {
  [docId: string]: DocOrFailure[]
}
interface ConflictRevsMap {
  [docId: string]: string[]
}

// Response Types for CouchDB's _bulk_get API:

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
  dataStore,
  dbServer
}: AppState) => async (keys: string[]): Promise<ConflictFreeResult[]> => {
  // Fetch the documents and any conflict rev IDs
  const fetchResults = (await dataStore.fetch(
    { keys },
    { conflicts: true }
  )) as nano.DocumentFetchResponse<StoreDocumentWithConflicts>

  /*
  Reduce the fetch results to two maps: 

  1. A map of document or failure objects
  2. A map of conflict revs

  Each map's key is the document key.
  */
  const [docsOrFailuresMap, conflictRevsMap] = fetchResults.rows.reduce<
    [DocsOrFailuresMap, ConflictRevsMap]
  >(
    ([documentsMap, conflictRevsMap], row) => {
      const rowDocOrFailure =
        'doc' in row && row.doc != null
          ? row.doc
          : (row as nano.DocumentLookupFailure)

      if (Array.isArray(documentsMap[row.key])) {
        documentsMap[row.key] = [...documentsMap[row.key], rowDocOrFailure]
      } else {
        documentsMap[row.key] = [rowDocOrFailure]
      }

      if (
        '_conflicts' in rowDocOrFailure &&
        rowDocOrFailure._conflicts != null
      ) {
        conflictRevsMap[row.key] = rowDocOrFailure._conflicts
      }

      return [documentsMap, conflictRevsMap]
    },
    [{}, {}]
  )

  /*
  Request any conflicting documents and add them to the docsOrFailuresMap.
  */
  const conflictDocs: Array<{ id: string; rev: string }> = Object.entries(
    conflictRevsMap
  ).flatMap(([id, revs]) => revs.map(rev => ({ id, rev })))

  if (conflictDocs.length > 0) {
    const conflictDocResponse: BulkGetResponse = await dbServer.request({
      db: config.couchDatabase,
      method: 'post',
      path: '_bulk_get',
      body: { docs: conflictDocs }
    })

    for (const result of conflictDocResponse.results) {
      docsOrFailuresMap[result.id] = [
        ...docsOrFailuresMap[result.id],
        ...result.docs.map(bulkGetResultDocToDocOrFailure)
      ]
    }
  }

  /*
  Get the merge base timestamps for each conflicting document.
  The merge base timestamp is the timestamp for the document from which all 
  conflicts have forked fork. The merge base should be the latest shared item in
  the timestampHistory between all of the conflicting documents.
  */
  const mergeBaseTimestampMap = Object.entries(docsOrFailuresMap).reduce<{
    [docId: string]: TimestampRev
  }>((map, [docId, docs]) => {
    // Skip for any document retrieval errors.
    // Errors should be handled at the call-site of this API function.
    if ('error' in docs[0]) {
      return map
    }

    const sharedTimestampHistory = docs
      .slice(1)
      .reduce<TimestampHistory>((sharedTimestampHistory, doc) => {
        if (!('error' in doc)) {
          const timestampHistory = timestampHistoryFromDocument(doc)
          sharedTimestampHistory = intersectTimestampHistory(
            sharedTimestampHistory,
            timestampHistory
          )
        }
        return sharedTimestampHistory
      }, timestampHistoryFromDocument(docs[0]))

    map[docId] = sharedTimestampHistory[0]?.timestamp

    return map
  }, {})

  // Create a conflict document set to contain all the document conflict results
  // and the merge base timestamp.
  const conflictDocumentSet = Object.entries(docsOrFailuresMap).map(
    ([id, docs]): ConflictDocumentSet => ({
      id,
      docs,
      mergeBaseTimestamp: mergeBaseTimestampMap[id]
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

  // There are no conflicts or there's an error if only one document in the set
  if (conflictDocumentSet.docs.length === 1) {
    const doc = conflictDocumentSet.docs[0]

    if ('error' in doc) {
      return new ConflictFreeResultError(doc.error, doc.key)
    }

    return { key: documentId, doc, conflicts: [] }
  }

  // Map over docs to include mergeBaseTimestamp in the StoreDocument
  const docs = conflictDocumentSet.docs.map(doc => {
    // Assert no errors in the document set because docs array is > 1
    if ('error' in doc) {
      throw new Error(
        `Unexpected document failure in conflict document set: ${doc.error}`
      )
    }

    return {
      ...doc,
      mergeBaseTimestamp
    }
  })

  // Merge the documents
  const winningDoc = docs
    .slice(1)
    .reduce<StoreDocument>((leftDoc, rightDoc) => {
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
      const directoryLikeDocument =
        leftDirectoryLikeDoc ?? rightDirectoryLikeDoc
      if (fileDoc != null && directoryLikeDocument != null) {
        return mergeTimestampedDocs(fileDoc, directoryLikeDocument)
      }

      // Assert that there should be no deleted documents while resolving conflicts
      if ('_deleted' in leftDoc || '_deleted' in rightDoc) {
        throw new Error(`Unexpected deleted document in conflict resolution`)
      }

      // Unknown document types
      throw new Error(
        'Unable to merge conflicts for documents of unknown type.'
      )
    }, docs[0])

  return {
    key: documentId,
    doc: winningDoc,
    conflicts: docs
      .filter(losingDoc => losingDoc._rev !== winningDoc._rev)
      .map(({ _id, _rev }) => ({ _id, _rev }))
  }
}

export const deleteDocuments = ({ dataStore }: AppState) => async (
  docs: Array<{ _id: string; _rev: string }>
): Promise<void> => {
  await dataStore.bulk({
    docs: docs.map(
      doc =>
        ({
          _id: doc._id,
          _rev: doc._rev,
          _deleted: true
        } as const)
    )
  })
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

export const timestampHistoryFromDocument = (
  doc: StoreDocument
): TimestampHistory => {
  return 'timestampHistory' in doc ? doc.timestampHistory : []
}

function bulkGetResultDocToDocOrFailure(
  bulkGetResult: BulkGetResultDoc | BulkGetResultError
): DocOrFailure {
  if ('error' in bulkGetResult) {
    return { key: bulkGetResult.error.id, error: bulkGetResult.error.error }
  }

  return bulkGetResult.ok
}
