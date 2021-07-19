import { assert, expect } from 'chai'
import { asMaybe } from 'cleaners'
import { asServerErrorResponse, EdgeBox } from 'edge-sync-client'
import { Response } from 'superagent'

export const delay = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export const isErrorResponse = (status: number, message?: string) => (
  res: Response
): void => {
  assert(
    res.status === status && (message === res.body.message || message == null),
    `Error ${res.status} (${JSON.stringify(res.body.message)}); ` +
      `Expected ${status}${message != null ? ` (${message})` : ''};`
  )
  expect(res.body).property('message').a('string')
}

export const isSuccessfulResponse = (res: Response): void => {
  if (res.status >= 200 && res.status < 300) return

  const errorResponse = asMaybe(asServerErrorResponse)(res.body)

  if (errorResponse != null) {
    throw new Error(
      `Not expecting error response: ${res.status} ${JSON.stringify(
        errorResponse.message
      )}${errorResponse.stack != null ? `:\n${errorResponse.stack}` : ''}`
    )
  }

  throw new Error(
    `Not expecting response: ${res.status} ${JSON.stringify(res.body)}`
  )
}

export const makeEdgeBox = (content: any): EdgeBox => ({
  iv_hex: '',
  encryptionType: 0,
  data_base64: typeof content === 'string' ? content : JSON.stringify(content)
})
