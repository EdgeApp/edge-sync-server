import { Checkpoint } from '../../../types/checkpoints'

export function compareHash(
  hash: string,
  hashBase: string
): 'current' | 'ahead' | 'behind' | 'conflicting' {
  const { version, sum } = parseHashToCheckpoint(hash)
  const { version: versionBase, sum: sumBase } = parseHashToCheckpoint(hashBase)

  return version === versionBase
    ? sum === sumBase
      ? 'current'
      : 'conflicting'
    : version > versionBase
    ? 'ahead'
    : 'behind'
}

function parseHashToCheckpoint(hash: string): Checkpoint {
  const checkpoint = hash.split(',')[0]
  const [versionPart, sumPart] = checkpoint.split(':')

  let version = parseInt(versionPart)
  let sum = parseInt(sumPart)

  if (isNaN(version) || isNaN(sum)) {
    version = 0
    sum = 0
  }

  return { version, sum }
}
