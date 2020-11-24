import { expect } from 'chai'
import { Response } from 'superagent'

export const delay = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export const isErrorResponse = (status: number, message?: string) => (
  res: Response
): void => {
  expect(res.status, 'res.status').equals(status)

  expect(res.body.success).to.equal(false, 'res.body.success')

  if (message !== undefined) {
    expect(res.body.message).to.equal(message)
  } else {
    expect(res.body.message).to.be.an('string', 'res.body.message')
  }
}

export const isSuccessfulResponse = (res): void => {
  if (res.body.success === false || res.body.message !== undefined) {
    console.error(res.body.error)
    throw new Error(
      `Not expecting error response: ${res.status} ${res.body.message}`
    )
  }
  expect(res.body.error, 'res.body.error').to.be.a('undefined')
  expect(res.status, 'res.status').to.be.least(200)
  expect(res.status, 'res.status').to.be.below(300)
}
