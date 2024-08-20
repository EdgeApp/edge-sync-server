import {
  asArray,
  asCodec,
  asEither,
  asNumber,
  asObject,
  asString,
  Cleaner,
  uncleaner
} from 'cleaners'

const MAX_CHECKPOINT_ARRAY_COUNT = 100

export const VALID_CHECKPOINT_REGEX = /^\d+:\d+$/
export const VALID_CHECKPOINT_ARRAY_REGEX = /^(\d+:\d+(,\d+:\d+)*)?$/

/**
 * A checkpoint is a versioning scheme for a store. It is a version and sum
 * pair delimitated by a colon (e.g. "5:15").
 *
 * The __version__ number is the repo's version number which is defined as the
 * highest version number of all the files in the repo (the max).
 *
 * The __sum__ number is the sum of all the file versions in the repo.
 */
export interface Checkpoint {
  version: number
  sum: number
}

/**
 * This is a codec cleaner that will parse a checkpoint string into a
 * `Checkpoint` object type.
 */
export const asCheckpoint: Cleaner<Checkpoint> = asCodec(
  (raw: unknown) => {
    const checkpoint = asEither(
      asString,
      asObject({ version: asNumber, sum: asNumber })
    )(raw)

    if (typeof checkpoint === 'string') {
      if (!VALID_CHECKPOINT_REGEX.test(checkpoint))
        throw TypeError('Expected checkpoint')

      const [version, sum] = checkpoint.split(':')

      return {
        version: parseInt(version),
        sum: parseInt(sum)
      }
    }

    return checkpoint
  },
  checkpoint => {
    return `${checkpoint.version}:${checkpoint.sum}`
  }
)

/**
 * This is the uncleaner for `asCheckpoint` codec that will parse a
 * `Checkpoint` object type back into a checkpoint string.
 */
export const wasCheckpoint = uncleaner(asCheckpoint)

/**
 * A checkpoint array is a list of checkpoints. It is a comma-delimited string
 * of checkpoints (e.g. "7:28,6:21,5:15").
 *
 * The list of checkpoints are ordered in descending order.
 *
 * The purpose of a checkpoints array string is to store a list of revisions for
 * a store. This is used when syncing a store with a client. The client will
 * provide its latest known checkpoints to the server and the server will
 * compare this revision history with it's own to determine the changes that
 * need to be sent back to the client.
 */
export type CheckpointArray = Checkpoint[]

/**
 * This is a codec cleaner that will parse a checkpoint array string into a
 * array of `Checkpoint[]` type.
 */
export const asCheckpointArray: Cleaner<CheckpointArray> = asCodec(
  (raw: unknown) => {
    const checkpoints = asEither(asString, asArray(asCheckpoint))(raw)

    if (typeof checkpoints === 'string') {
      if (!VALID_CHECKPOINT_ARRAY_REGEX.test(checkpoints))
        throw TypeError('Expected checkpoint set')

      return checkpoints.split(',').map(asCheckpoint)
    }

    return checkpoints
  },
  checkpoints =>
    checkpoints
      .map(checkpoint => wasCheckpoint(checkpoint))
      .slice(0, MAX_CHECKPOINT_ARRAY_COUNT)
      .join(',')
)
/**
 * This is the uncleaner for `asCheckpoints` codec that will parse a
 * `Checkpoint[]` type back into a checkpoint array string.
 */
export const wasCheckpointArray = uncleaner(asCheckpointArray)
