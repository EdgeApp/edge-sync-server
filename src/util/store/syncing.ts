import { asMaybe } from 'cleaners'
import { errorCause } from 'edge-server-tools'
import { ChangeSet } from 'edge-sync-client'

import { AppState } from '../../server'
import { Checkpoint, CheckpointArray } from '../../types/checkpoints'
import { asStoreFileDocument, StoreFileDocument } from '../../types/store-types'
import { trial } from '../trial'
import { withRetries } from '../with-retries'
import { equalCheckpoints, getCheckpointAt } from './checkpoints'
import { checkDbResponseForErrors } from './error-checking'

export const writeUpdates = (appState: AppState) => (
  repoId: string,
  changeSet: ChangeSet
): Promise<void> =>
  withRetries(
    async (): Promise<void> => {
      const latestCheckpoint = await getCheckpointAt(appState)(repoId)

      // Query for documents
      const keys = Object.keys(changeSet).map(path => `${repoId}:${path}`)
      const fetchResponse = await appState.storeDb.fetch({ keys })

      // Prepare updated documents
      const updatedStoreFileDocs = fetchResponse.rows.map((row, i) => {
        const path = row.key.split(':')[1]
        const box = changeSet[path]
        const newVersion = latestCheckpoint.version + i + 1

        if (row.error != null && row.error !== 'not_found') {
          throw new Error(row.error)
        }

        const existingStoreFileDoc =
          'doc' in row && row.doc != null
            ? asMaybe(asStoreFileDocument)(row.doc)
            : undefined
        const templateStoreFileDoc = existingStoreFileDoc ?? {
          _id: row.key,
          box,
          timestamp: Date.now(),
          versions: []
        }

        return {
          ...templateStoreFileDoc,
          box,
          timestamp: Date.now(),
          versions: [newVersion, ...templateStoreFileDoc.versions]
        }
      })

      // Bulk update
      const updateResponse = await appState.storeDb.bulk({
        docs: updatedStoreFileDocs
      })

      // Check for any errors from update
      checkDbResponseForErrors(updateResponse)
    },
    err => err.message === 'conflict'
  )

export interface RepoUpdates {
  checkpoints: CheckpointArray
  changeSet: ChangeSet
}

export const readUpdates = (appState: AppState) => async (
  repoId: string,
  checkpoints: CheckpointArray
): Promise<RepoUpdates> => {
  const [currentCheckpoint = { version: 0, sum: 0 }] = checkpoints

  // Query view for file documents with version > currentCheckpoint.version
  const fileDocumentsResponse = await appState.storeDb.partitionedView(
    repoId,
    'versioning',
    'version',
    {
      include_docs: true,
      reduce: false,
      // Add 1 because range is exclusive
      start_key: currentCheckpoint.version + 1
    }
  )

  const storeFileDocs = fileDocumentsResponse.rows.map(row => {
    return trial(
      () => asStoreFileDocument(row.doc),
      err => {
        throw errorCause(
          new Error(`Expected StoreFile document for ${row.id}`),
          err
        )
      }
    )
  })

  // Query view for checkpoint sum where version ≤ currentCheckpoint.version
  const { sum: wipSum } = await getCheckpointAt(appState)(
    repoId,
    currentCheckpoint.version
  )

  // The expected difference between client and server sums
  // caused by overwritten documents.
  const overwriteDiff = storeFileDocs.reduce((sum, storeFile) => {
    const historicalVersions = storeFile.versions
      .slice(1)
      .filter(version => version <= currentCheckpoint.version)

    return sum + (historicalVersions[0] ?? 0)
  }, 0)

  // Adjusted checkpoint sum includes the overwriteDiff
  const adjustedSum = wipSum + overwriteDiff

  // Verify current checkpoint
  // If not equal, drop highest client checkpoint and retry
  if (adjustedSum !== currentCheckpoint.sum) {
    return await readUpdates(appState)(repoId, checkpoints.slice(1))
  }

  // Calculate latest checkpoint
  const latestCheckpoint = calculateLatestCheckpoint(
    currentCheckpoint,
    storeFileDocs
  )

  // Include latest checkpoint in new checkpoints array
  const updatedCheckpoints = equalCheckpoints(
    currentCheckpoint,
    latestCheckpoint
  )
    ? [...checkpoints]
    : [latestCheckpoint, ...checkpoints]

  // Prepare changeSet
  const changeSet: ChangeSet = storeFileDocs.reduce(
    (changeSet, storeFileDoc) => {
      const path = storeFileDoc._id.split(':')[1]
      return { ...changeSet, [path]: storeFileDoc.box }
    },
    {}
  )

  // Return changeset and new checkpoints
  return {
    checkpoints: updatedCheckpoints,
    changeSet
  }
}

/**
 * Calculates what would be the latest checkpoint given set of new documents
 * past a given checkpoint.
 */
const calculateLatestCheckpoint = (
  checkpoint: Checkpoint,
  newDocuments: StoreFileDocument[]
): Checkpoint => {
  // The max of all the new document versions
  const latestVersion = newDocuments.reduce(
    (version, document) => Math.max(version, document.versions[0]),
    checkpoint.version
  )
  // current checkpoint sum + new document versions - previous document versions
  const latestSum = newDocuments.reduce((sum, document) => {
    // Remove any previous document versions being overwritten.
    // If there exists versions that are lower or equal than the current
    // checkpoint version, then the max is the previous version.
    const previousVersion = Math.max(
      0,
      ...document.versions.filter(version => version <= checkpoint.version)
    )
    // Add latest version and subtract previous version.
    return sum + document.versions[0] - previousVersion
  }, checkpoint.sum)

  // Create checkpoint using new calculated values and return
  const latestCheckpoint = { version: latestVersion, sum: latestSum }
  return latestCheckpoint
}
