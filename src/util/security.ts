import bs58 from 'bs58'
import { createHash } from 'crypto'

export const syncKeyToRepoId = (syncKey: string): string => {
  const bytes = Buffer.from(syncKey, 'hex')
  const hashBytes = sha256(sha256(bytes))
  return bs58.encode(hashBytes)
}

const sha256 = (input: Uint8Array): Uint8Array => {
  const hash = createHash('sha256')
  hash.update(input)
  return hash.digest()
}
