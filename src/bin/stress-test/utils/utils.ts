import { randomInt } from 'crypto'

import { RequestError } from '../SyncClient'
import { AllEvents } from '../types'

export const send = (...args: Array<AllEvents | string | Error>): void => {
  if (process.send != null) {
    const serializedArgs = args.map(arg =>
      typeof arg === 'string'
        ? {
            type: 'message',
            process: process.title,
            message: arg
          }
        : arg instanceof RequestError
        ? {
            type: 'error',
            process: process.title,
            err: {
              name: arg.name,
              message: arg.message,
              stack: arg.stack,
              request: arg.request,
              response: arg.response
            }
          }
        : arg instanceof Error
        ? {
            type: 'error',
            process: process.title,
            err: {
              name: arg.name,
              message: arg.message,
              stack: arg.stack
            }
          }
        : arg
    )
    process.send(serializedArgs.length > 1 ? serializedArgs : serializedArgs[0])
  } else {
    args.forEach(arg =>
      arg instanceof Error ? console.error(arg) : console.log(arg)
    )
  }
}

const randomHex = (size: number): string =>
  [...Array(size)]
    .map(() => Math.floor(Math.random() * 16).toString(16))
    .join('')

export const randomBytes = (bytes: number): Buffer => {
  return Buffer.from(randomHex(Math.ceil(bytes / 2)), 'hex')
}

export const makeSyncKey = (
  index: number,
  prefix: string = '00000000000000000000'
): string => {
  const hexLength = 40 - prefix.length
  return `${prefix}${Math.floor(index).toString(16).padStart(hexLength, '0')}`
}

export const randomPath = (): string => {
  return `${randomHex(2)}`
}

export const randomElement = <T>(elements: T[]): T =>
  elements[randomInt(0, elements.length)]

export const criticalError = (err: any): void => {
  console.error(err)
  process.exit(1)
}

// Error handlers

export const isAcceptableError = (err: any): boolean =>
  err?.response != null ? isRepoNotFoundError(err) : false
export const isRepoNotFoundError = (err: any): boolean =>
  /^Repo not found$/.test(err?.response.message)

// Waits some time before calling a function
export const throttle = <T>(fn: () => Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) =>
    setTimeout(() => {
      fn().then(resolve).catch(reject)
    }, ms)
  )

export const delay = (ms: number): Promise<void> =>
  new Promise<void>(resolve => setTimeout(resolve, ms))

export const addToAverage = (
  amount: number,
  avg: number,
  count: number
): number => {
  return (avg * count + amount) / (count + 1)
}

export const msToPerSeconds = (ms: number): number => {
  return ms !== 0 ? 1000 / ms : 0
}
