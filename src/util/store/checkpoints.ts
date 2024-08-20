import { asMaybe, asNull, asNumber, asObject } from 'cleaners'
import { DocumentViewParams } from 'nano'

import { AppState } from '../../server'
import {
  asCheckpointArray,
  Checkpoint,
  CheckpointArray
} from '../../types/checkpoints'

const asReduceValues = asObject({
  key: asNull,
  value: asObject({
    sum: asNumber,
    count: asNumber,
    min: asNumber,
    max: asNumber,
    sumsqr: asNumber
  })
})

export const getCheckpointAt = (appState: AppState) => async (
  repoId: string,
  version?: number
): Promise<Checkpoint> => {
  const queryParams: DocumentViewParams = {
    include_docs: false,
    reduce: true,
    end_key: version
  }

  const response = await appState.storeDb.partitionedView(
    repoId,
    'versioning',
    'version',
    queryParams
  )

  if (response.rows.length === 0) return { version: 0, sum: 0 }

  const indexInfo = asReduceValues(response.rows[0])
  const { sum, max } = indexInfo.value

  return { version: max, sum }
}

/**
 * Get the checkpoints from a hash route parameter string. If the hash is not
 * a checkpoint array string, then an empty array is returned. This is a
 * compatibility function for the `GET /v2/store/:hash` endpoint prior to
 * the migration from the git-based sync server implementation.
 *
 * @param hash The hash parameter from the `GET /v2/store/:hash` endpoint.
 * @returns The `CheckpointArray` from the given hash parameter.
 */
export const getCheckpointsFromHash = (
  hash: string | undefined
): CheckpointArray => {
  return asMaybe(asCheckpointArray)(hash) ?? []
}

/**
 * Compares the equality of two checkpoints.
 */
export const equalCheckpoints = (a: Checkpoint, b: Checkpoint): boolean => {
  return a.version === b.version && a.sum === b.sum
}
