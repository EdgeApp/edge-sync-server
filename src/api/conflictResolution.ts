import { add, div, gt, mul } from 'biggystring'
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
type BulkGetDoc = StoreDocument & {
  _revisions: {
    start: number
    ids: string[]
  }
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
    qs: {
      revs: true
    },
    body: { docs }
  })

  /*
  Get all the merge base document revs for each conflicting document.
  The merge base document is the document from which all conflicts fork.
  The merge base document rev should be the latest shared rev between all
  conflicting documents.
  */
  const mergeBaseDocIds = response.results
    .map(result => {
      const id = result.id

      if (!('ok' in result.docs[0])) {
        // Handle all errors except for not_found
        if (result.docs[0].error.error !== 'not_found') {
          throw new Error(
            `Failed to get rev for merge base document '${id}'. ${JSON.stringify(
              result.docs[0].error
            )}`
          )
        }

        return { id, rev: '' }
      }

      const sharedRevs = result.docs
        .slice(1)
        .reduce<string[]>((sharedRevs, resultDoc) => {
          if ('ok' in resultDoc) {
            const revs = revsFromBulkGetResultDoc(resultDoc)
            sharedRevs = intersectRevs(sharedRevs, revs)
          }
          return sharedRevs
        }, revsFromBulkGetResultDoc(result.docs[0]))

      return { id, rev: sharedRevs[0] }
    })
    // Filter out the not_found error cases
    .filter(({ rev }) => rev !== '' && rev != null)

  // Retrieve the merge base documents
  const mergeBaseDocsResponse: BulkGetResponse = await dbServer.request({
    db: config.couchDatabase,
    method: 'post',
    path: '_bulk_get',
    body: { docs: mergeBaseDocIds }
  })

  // Map each merge base document id to the document timestamp
  const mergeBaseTimestampMap = mergeBaseDocsResponse.results.reduce<{
    [id: string]: TimestampRev
  }>((map, result) => {
    const id = result.id
    const bulkGetResultDoc = result.docs[0]

    if (result.docs.length > 1) {
      throw Error(`Merge base document should not have conflicts!`)
    }

    // Throw because we shouldn't be getting errors on merge base retrieval
    if ('error' in bulkGetResultDoc) {
      throw Error(
        `Failed to retrieve merge base document '${id}': ${JSON.stringify(
          bulkGetResultDoc.error
        )}`
      )
    }

    // The merge base document should have a timestamp
    if (!('timestamp' in bulkGetResultDoc.ok)) {
      throw Error(`Missing timestamp in merge base document '${id}'`)
    }

    const timestamp: TimestampRev = asTimestampRev(
      bulkGetResultDoc.ok.timestamp
    )

    map[id] = timestamp

    return map
  }, {})

  // Create a conflict document set to contain all the document conflict results
  // and the merge base timestamp.
  const conflictDocumentSet = response.results.map(
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

    // Handle any document conflicts that are deleted documents
    if ('_deleted' in leftDoc) {
      if (rightFileDoc != null) return rightFileDoc
      if (rightDirectoryLikeDoc != null) return rightDirectoryLikeDoc
    }
    if ('_deleted' in rightDoc) {
      if (leftFileDoc != null) return leftFileDoc
      if (leftDirectoryLikeDoc != null) return leftDirectoryLikeDoc
    }
    // If both documents are deleted documents, then just return one
    if ('_deleted' in leftDoc && '_deleted' in rightDoc) {
      return leftDoc
    }

    // Unknown document types:
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

export const intersectRevs = (
  leftRevs: string[],
  rightRevs: string[]
): string[] => leftRevs.filter(leftRev => rightRevs.includes(leftRev))

export const revsFromBulkGetResultDoc = (
  resultDoc: BulkGetResultDoc
): string[] => {
  const start = resultDoc.ok._revisions.start
  return resultDoc.ok._revisions.ids.map((id, i) => `${start - i}-${id}`)
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

  // Generate the docs to delete for the bulk request
  const deletedDocs = response.results.reduce<
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
