import { assert, expect } from 'chai'
import { Response } from 'superagent'

import { AppState } from '../src/server'
import { asTimestampRev, StoreFile } from '../src/types'

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
  if (res.body.success === false || res.body.message !== undefined) {
    throw new Error(
      `Not expecting error response: ${res.status} ${JSON.stringify(
        res.body.message
      )}${res.body.error != null ? `:\n${JSON.stringify(res.body.error)}` : ''}`
    )
  }
  expect(res.body.error, 'res.body.error').to.be.a('undefined')
  expect(res.status, 'res.status').to.be.least(200)
  expect(res.status, 'res.status').to.be.below(300)
}

export const makeMockStoreFile = (data: object): StoreFile => {
  const dataBase64 = JSON.stringify(data)

  return {
    timestamp: asTimestampRev(Date.now()),
    box: {
      iv_hex: '',
      encryptionType: 0,
      data_base64: dataBase64
    }
  }
}

export const synchronizeServers = async (
  appStateSource: AppState,
  appStateTarget: AppState
): Promise<void> => {
  try {
    await appStateTarget.dbServer.request({
      method: 'post',
      path: '_replicate',
      body: {
        source: appStateSource.config.couchDatabase,
        target: appStateTarget.config.couchDatabase
      }
    })
  } catch (error) {
    throw new Error([`Failed to synchronize servers:`, error].join(' '))
  }
}
