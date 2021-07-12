import { asArray } from 'cleaners'
import { bulkGet, errorCause } from 'edge-server-tools'
import nano from 'nano'

import { storeDatabaseName } from '../../db/store-db'
import { AppState } from '../../server'
import {
  asStoreFileDocument,
  asStoreRepoDocument,
  StoreDocument,
  StoreFileDocument,
  StoreRepoDocument
} from '../../types/store-types'
import { asTrialAndError, trial } from '../trial'

export const resolveAllDocumentConflicts = (appState: AppState) => async (
  repoId: string
): Promise<void> => {
  const { couchUri } = appState.config

  // Query for document IDs with conflicts using the conflictRevs view
  const conflictQueryResponse = await appState.storeDb.partitionedView<
    string[]
  >(repoId, 'conflicts', 'conflictRevs', {
    include_docs: false
  })
  const docRefs = conflictQueryResponse.rows.flatMap(row =>
    row.value.map(rev => ({ id: row.id, rev }))
  )

  // Query for the conflicting documents by document reference (id and rev)
  // using _bulk_get
  const documentsResponse = await bulkGet<StoreDocument>(
    couchUri,
    storeDatabaseName,
    docRefs
  )

  // Map each unique document _id to an array of conflicting documents
  const documentMap: { [id: string]: StoreDocument[] } = {}
  for (const result of documentsResponse.results) {
    for (const doc of result.docs) {
      if ('error' in doc) {
        const { id, rev, error, reason } = doc.error
        throw new Error(
          `Unexpected database error for ${id} ${rev}: ${error} - ${reason}`
        )
      }
      if (documentMap[doc.ok._id] == null) documentMap[doc.ok._id] = []

      documentMap[doc.ok._id].push(doc.ok)
    }
  }

  // Resolve each conflicting document
  const documentUpdates: StoreDocument[] = []
  for (const documents of Object.values(documentMap)) {
    documentUpdates.push(...resolvedDocumentUpdates(documents))
  }

  // Write the resolved documents to the database
  await appState.storeDb.bulk({ docs: documentUpdates })
}

export function resolvedDocumentUpdates(
  documents: StoreDocument[]
): StoreDocument[] {
  const docId = documents[0]._id

  // Partial sort documents before mutating them
  const [winningDoc, ...losingDocs] = documents
    .slice(1)
    .reduce<StoreDocument[]>(
      (sortedDocuments, rightDoc) => {
        const leftDoc = sortedDocuments.shift()

        // Assertion: left doc should not be undefined.
        if (leftDoc == null)
          throw new Error(
            `Unexpected error: missing left document in conflict resolution for ${docId}`
          )

        return trial<StoreDocument[]>(
          () => {
            // // Merge file documents
            const leftFileDoc = asStoreFileDocument(leftDoc)
            const rightFileDoc = asStoreFileDocument(rightDoc)
            const [winningDoc, losingDoc] = sortStoreFileDocuments(
              leftFileDoc,
              rightFileDoc
            )
            return [winningDoc, losingDoc, ...sortedDocuments]
          },
          err => {
            if (!(err instanceof TypeError)) throw err

            // Merge repo documents
            const leftRepoDoc = asTrialAndError(
              asStoreRepoDocument,
              err
            )(leftDoc)
            const rightRepoDoc = asTrialAndError(
              asStoreRepoDocument,
              err
            )(rightDoc)
            // Pick the
            const [winningDoc, losingDoc] = sortStoreRepoDocuments(
              leftRepoDoc,
              rightRepoDoc
            )
            return [winningDoc, losingDoc, ...sortedDocuments]
          },
          err => {
            throw errorCause(
              new Error(
                `Unexpected document types in conflict resolver for '${docId}'`
              ),
              err
            )
          }
        )
      },
      [documents[0]]
    )

  return mergeStoreDocuments(winningDoc, losingDocs)
}

function mergeStoreDocuments(
  winningDoc: StoreDocument,
  losingDocs: StoreDocument[]
): StoreDocument[] {
  const docId = winningDoc._id

  const updatedDocument = trial<StoreDocument>(
    () => {
      const winningStoreFileDoc = asStoreFileDocument(winningDoc)
      const losingStoreFileDocs = asArray(asStoreFileDocument)(losingDocs)
      return mergeStoreFileDocuments(winningStoreFileDoc, losingStoreFileDocs)
    },
    err => {
      if (!(err instanceof TypeError)) throw err

      const winningStoreRepoDoc = asTrialAndError(
        asStoreRepoDocument,
        err
      )(winningDoc)

      return winningStoreRepoDoc
    },
    err => {
      throw errorCause(
        new Error(
          `Unexpected document types in conflict resolver for '${docId}'`
        ),
        err
      )
    }
  )

  return [updatedDocument, ...losingDocs.map(makeDeletedDocument)]
}

function mergeStoreFileDocuments(
  winningDoc: StoreFileDocument,
  losingDocs: StoreFileDocument[]
): StoreFileDocument {
  const updatedDocument = { ...winningDoc }

  // Count how many losing documents have an equal latest version to the winning
  const sameVersionCount = losingDocs.reduce(
    (count, doc) =>
      count + (doc.versions[0] === updatedDocument.versions[0] ? 1 : 0),
    0
  )

  // Merged all file's versions
  updatedDocument.versions = mergeVersions(
    updatedDocument.versions,
    losingDocs.reduce<number[]>(
      (versions, doc) => [...versions, ...doc.versions],
      []
    )
  )

  // Add a new version if conflicts have same latest version
  if (sameVersionCount !== 0)
    updatedDocument.versions.unshift(
      updatedDocument.versions[0] + sameVersionCount
    )

  return updatedDocument
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

function sortStoreRepoDocuments(
  leftRepoDoc: StoreRepoDocument,
  rightRepoDoc: StoreRepoDocument
): [StoreDocument, StoreDocument] {
  if (leftRepoDoc.timestamp !== rightRepoDoc.timestamp) {
    if (leftRepoDoc.timestamp > rightRepoDoc.timestamp) {
      return [leftRepoDoc, rightRepoDoc]
    } else {
      return [rightRepoDoc, leftRepoDoc]
    }
  } else {
    if (leftRepoDoc._rev > rightRepoDoc._rev) {
      return [leftRepoDoc, rightRepoDoc]
    } else {
      return [rightRepoDoc, leftRepoDoc]
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
