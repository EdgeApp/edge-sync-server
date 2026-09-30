import bs58 from 'bs58'
import { Cleaner } from 'cleaners'

/**
 * A repo ID is the base58 encoding of a 32-byte double SHA-256 hash, so it
 * is at most 44 characters and decodes to exactly 32 bytes.
 */
export const asRepoId: Cleaner<string> = raw => {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 44) {
    throw new TypeError('Expected a repo ID')
  }
  let bytes: Uint8Array
  try {
    bytes = bs58.decode(raw)
  } catch (error) {
    throw new TypeError('Expected a repo ID')
  }
  if (bytes.length !== 32) throw new TypeError('Expected a repo ID')
  return raw
}
