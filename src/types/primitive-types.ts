import { asNumber, asObject, asString } from 'cleaners'

// Regexes:
export const VALID_PATH_REGEX = /^(\/([^/ ]+([ ]+[^/ ]+)*)+)+\/?$/
export const VALID_SYNC_KEY_REGEX = /^[a-f0-9]{40}$/

// Primitive Types

export const asNonEmptyString = (raw: any): string => {
  const str = asString(raw)

  if (str === '') {
    throw new TypeError('Expected non empty string')
  }

  return str
}

export const asPath = (raw: any): string => {
  const path = asString(raw)

  if (!VALID_PATH_REGEX.test(path)) {
    throw new Error(`Invalid path '${path}'`)
  }

  return path
}

export const asSyncKey = (raw: any): string => {
  const syncKey = asString(raw)

  if (!VALID_SYNC_KEY_REGEX.test(syncKey)) {
    throw new TypeError(`Invalid sync key '${syncKey}'`)
  }

  return syncKey
}

export type EdgeBox = ReturnType<typeof asEdgeBox>
export const asEdgeBox = asObject({
  iv_hex: asString,
  encryptionType: asNumber,
  data_base64: asString
})

// Server Error Types:

export interface ApiErrorResponse {
  success: false
  message: string
  error?: string
}

export class ApiClientError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
