import { assert, expect } from 'chai'
import { Response } from 'superagent'

import { StoreFile } from '../src/types'

export const delay = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export const isErrorResponse = (status: number, message?: string) => (
  res: Response
): void => {
  assert(
    res.status === status && (message === res.body.message || message == null),
    [
      `Error`,
      res.status,
      `(`,
      res.body.message,
      `);`,
      `Expected`,
      status,
      message != null ? [`(`, message, `)`].join(' ') : '',
      `;`
    ].join(' ')
  )
  expect(res.body).property('message').a('string')
}

export const isSuccessfulResponse = (res): void => {
  if (res.body.success === false || res.body.message !== undefined) {
    throw new Error(
      [
        `Not expecting error response:`,
        res.status,
        res.body.message,
        res.body.error != null ? [`:\n`, res.body.error].join(' ') : ''
      ].join(' ')
    )
  }
  expect(res.body.error, 'res.body.error').to.be.a('undefined')
  expect(res.status, 'res.status').to.be.least(200)
  expect(res.status, 'res.status').to.be.below(300)
}

export const makeMockStoreFile = (data: object): StoreFile => {
  const dataBase64 = JSON.stringify(data)

  return {
    timestamp: Date.now(),
    box: {
      iv_hex: '',
      encryptionType: 0,
      data_base64: dataBase64
    }
  }
}
