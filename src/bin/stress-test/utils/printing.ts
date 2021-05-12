// Print Utilties

import logUpdate from 'log-update'
import { inspect } from 'util'

export const prettyPrintObject = (obj: object): string => {
  const keyMaxLength = Object.keys(obj).reduce(
    (max, key) => Math.max(max, key.length),
    0
  )

  return Object.entries(obj)
    .map(([key, val]) => {
      return [
        key.padEnd(keyMaxLength, ' '),
        typeof val === 'string'
          ? val
          : inspect(val, { depth: Infinity, colors: true })
      ].join(' = ')
    })
    .join('\n')
}
export const statusBarLine = (): string =>
  Array.from({ length: process.stdout.columns })
    .map(() => '-')
    .join('')

let statusText: string = ''

export const statusBox = (text: string): void => {
  const line = statusBarLine()
  logUpdate([line, text].join('\n'))
  statusText = text
}

export const print = (...args: any[]): void => {
  args.forEach(arg => {
    const text =
      typeof arg === 'string'
        ? arg
        : inspect(arg, { depth: Infinity, colors: true })
    logUpdate(text)
    logUpdate.done()
  })
  statusBox(statusText)
}
