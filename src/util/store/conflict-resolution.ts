import { asArray, asMaybe } from 'cleaners'
import { bulkGet } from 'edge-server-tools'
import nano from 'nano'

import { storeDatabaseName } from '../../db/store-db'
import { AppState } from '../../server'
import {
  asStoreFileDocument,
  StoreDocument,
  StoreFileDocument
} from '../../types/store-types'

export const resolveAllDocumentConflicts = (appState: AppState) => async (
  repoId: string
): Promise<void> => {
  const { couchUri } = appState.config

  // Query for document IDs with conflicts using the conflictRevs view
  const conflictQueryResponse = await appState.storeDb.partitionedView(
    repoId,
    'conflicts',
    'conflictRevs',
    {
      include_docs: false
    }
  )
  const docIds = conflictQueryResponse.rows.map(row => ({ id: row.id }))

  // Query for the conflicting documents for each document ID using _bulk_get
  const documentsResponse = await bulkGet<StoreDocument>(
    couchUri,
    storeDatabaseName,
    docIds
  )

  const documentUpdates: StoreDocument[] = []

  for (const result of documentsResponse.results) {
    const documents = result.docs.map(resultDoc => {
      if ('error' in resultDoc) {
        const { id, rev, error, reason } = resultDoc.error
        throw new Error(
          `Unexpected database error for ${id} ${rev}: ${error} - ${reason}`
        )
      }
      return resultDoc.ok
    })

    documentUpdates.push(...resolvedDocumentUpdates(documents))
  }

  await appState.storeDb.bulk({ docs: documentUpdates })
}

export function resolvedDocumentUpdates(
  documents: StoreDocument[]
): StoreDocument[] {
  // Partial sort documents before mutating them
  const [winningDoc, ...losingDocs] = documents
    .slice(1)
    .reduce<StoreDocument[]>(
      (sortedDocuments, rightDoc) => {
        const leftDoc = sortedDocuments.shift()

        // Assertion: left doc should not be undefined.
        if (leftDoc == null)
          throw new Error(
            'Unexpected error: missing left document in conflict resolution'
          )

        const leftFileDoc = asMaybe(asStoreFileDocument)(leftDoc)
        const rightFileDoc = asMaybe(asStoreFileDocument)(rightDoc)

        // Merge file documents
        if (leftFileDoc != null && rightFileDoc != null) {
          const [winningDoc, losingDoc] = sortStoreFileDocuments(
            leftFileDoc,
            rightFileDoc
          )
          return [winningDoc, losingDoc, ...sortedDocuments]
        }

        // Assert that there should be no deleted documents while resolving conflicts
        if ('_deleted' in leftDoc || '_deleted' in rightDoc) {
          throw new Error(`Unexpected deleted document in conflict resolution`)
        }

        // Unknown document types
        throw new Error('Unexpected document types in conflict resolver')
      },
      [documents[0]]
    )

  const winningStoreFileDoc = asMaybe(asStoreFileDocument)(winningDoc)
  const losingStoreFileDocs = asMaybe(asArray(asStoreFileDocument))(losingDocs)

  if (winningStoreFileDoc != null && losingStoreFileDocs != null) {
    mergeStoreFileDocuments(winningStoreFileDoc, losingStoreFileDocs)
  } else {
    throw new Error('Unexpected document types in conflict resolver')
  }

  const updatedDocuments = [
    winningStoreFileDoc,
    ...losingDocs.map(makeDeletedDocument)
  ]

  return updatedDocuments
}

function mergeStoreFileDocuments(
  winningDoc: StoreFileDocument,
  losingDocs: StoreFileDocument[]
): void {
  // Count how many losing documents have an equal latest version to the winning
  const sameVersionCount = losingDocs.reduce(
    (count, doc) =>
      count + (doc.versions[0] === winningDoc.versions[0] ? 1 : 0),
    0
  )

  // Merged all file's versions
  winningDoc.versions = mergeVersions(
    winningDoc.versions,
    losingDocs.reduce<number[]>(
      (versions, doc) => [...versions, ...doc.versions],
      []
    )
  )

  // Add a new version if conflicts have same latest version
  if (sameVersionCount !== 0)
    winningDoc.versions.unshift(winningDoc.versions[0] + sameVersionCount)
}

function sortStoreFileDocuments(
  leftFileDoc: StoreFileDocument,
  rightFileDoc: StoreFileDocument
): [StoreDocument, StoreDocument] {
  // If conflicting files have different versions, write merged file with
  // higher version & merged versions lists.
  if (leftFileDoc.versions[0] !== rightFileDoc.versions[0]) {
    if (leftFileDoc.versions[0] > rightFileDoc.versions[0]) {
      return [leftFileDoc, rightFileDoc]
    } else {
      return [rightFileDoc, leftFileDoc]
    }
  } else if (leftFileDoc.timestamp !== rightFileDoc.timestamp) {
    // If conflicting files have same versions, write merged file with
    // version + 1 and drop conflict version from list.
    if (leftFileDoc.timestamp > rightFileDoc.timestamp) {
      return [leftFileDoc, rightFileDoc]
    } else {
      return [rightFileDoc, leftFileDoc]
    }
  } else {
    // If the conflicting files are the same except for _rev, just delete the
    // conflicting version (lower rev).
    if (leftFileDoc._rev > rightFileDoc._rev) {
      return [leftFileDoc, rightFileDoc]
    } else {
      return [rightFileDoc, leftFileDoc]
    }
  }
}

function makeDeletedDocument(document: nano.Document): StoreDocument {
  return { _id: document._id, _rev: document._rev, _deleted: true }
}

// TODO: Performance test this and optimize if needed
function mergeVersions(v1: number[], v2: number[]): number[] {
  return Array.from(new Set([...v1, ...v2])).sort((a, b) => b - a)
}
