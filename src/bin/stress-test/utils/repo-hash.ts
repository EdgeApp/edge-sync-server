import { eq, gt, toFixed } from 'biggystring'

export function compareHash(
  hash: string,
  hashBase: string
): 'current' | 'ahead' | 'behind' | 'conflicting' {
  return eq(hash, hashBase)
    ? 'current'
    : gt(hash, hashBase)
    ? gt(toFixed(hash, 0, 0), hashBase)
      ? 'ahead'
      : 'conflicting'
    : 'behind'
}
