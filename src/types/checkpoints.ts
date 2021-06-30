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

export interface Checkpoint {
  version: number
  sum: number
}
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
export const wasCheckpoint = uncleaner(asCheckpoint)

export type CheckpointArray = Checkpoint[]
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
export const wasCheckpointArray = uncleaner(asCheckpointArray)
