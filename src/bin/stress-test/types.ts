import {
  asArray,
  asMap,
  asNumber,
  asObject,
  asString,
  asUnknown,
  Cleaner
} from 'cleaners'

import { asTimestampRev } from '../../types'

export const asLiteral = <T extends string | number | null | undefined | {}>(
  literal: T
) => (raw: any): T => {
  if (raw !== literal) {
    throw new TypeError(
      `Expected ${typeof literal} literal '${JSON.stringify(literal)}'`
    )
  }
  return raw
}

export function asUnion<T extends Array<Cleaner<any>>>(
  ...cs: readonly [...T]
): Cleaner<ReturnType<T[number]>> {
  const exceptions: TypeError[] = []

  return function asUnion(raw: any): ReturnType<T[number]> {
    let val: ReturnType<T[number]> | undefined
    cs.forEach(c => {
      try {
        val = c(raw)
      } catch (e) {
        exceptions.push(e.message)
      }
    })

    if (val !== undefined) {
      return val
    } else {
      const message = `Union type\n  ${exceptions.join(' or\n  ')}`
      throw new TypeError(message)
    }
  }
}

// Shared error output type
export type ErrorEvent = ReturnType<typeof asErrorEvent>
export const asErrorEvent = asObject({
  type: asLiteral('error'),
  process: asString,
  message: asString,
  stack: asString,
  request: asUnknown,
  response: asUnknown
})

export type MessageEvent = ReturnType<typeof asMessageEvent>
export const asMessageEvent = asObject({
  type: asLiteral('message'),
  process: asString,
  message: asString
})

// Worker

export type WorkerInput = ReturnType<typeof asWorkerInput>
export const asWorkerInput = asObject({
  clusters: asMap(asArray(asString)),
  repoId: asString,
  repoUpdatesPerMin: asNumber,
  repoUpdateIncreaseRate: asNumber,
  maxUpdatesPerRepo: asNumber,
  fileByteSizeRange: asArray(asNumber),
  fileCountRange: asArray(asNumber)
})

// Events

export type ReadyEvent = ReturnType<typeof asReadyEvent>
export const asReadyEvent = asObject({
  type: asLiteral('ready'),
  serverHost: asString,
  repoId: asString,
  requestTime: asNumber,
  serverRepoTimestamp: asTimestampRev
})

export type UpdateEvent = ReturnType<typeof asUpdateEvent>
export const asUpdateEvent = asObject({
  type: asLiteral('update'),
  serverHost: asString,
  repoId: asString,
  requestTime: asNumber,
  serverRepoTimestamp: asTimestampRev,
  payloadSize: asNumber
})

export type CheckEvent = ReturnType<typeof asCheckEvent>
export const asCheckEvent = asObject({
  type: asLiteral('check'),
  serverHost: asString,
  repoId: asString,
  requestTime: asNumber,
  serverRepoTimestamp: asTimestampRev
})

export type RepoSyncEvent = ReturnType<typeof asRepoSyncEvent>
export const asRepoSyncEvent = asObject({
  type: asLiteral('repo-sync'),
  timestamp: asNumber,
  serverHost: asString,
  repoId: asString
})

export type ServerSyncEvent = ReturnType<typeof asServerSyncEvent>
export const asServerSyncEvent = asObject({
  type: asLiteral('server-sync'),
  timestamp: asNumber,
  serverHost: asString
})

export type NetworkSyncEvent = ReturnType<typeof asNetworkSyncEvent>
export const asNetworkSyncEvent = asObject({
  type: asLiteral('network-sync'),
  timestamp: asNumber
})

// Unions

export type AllEvents = ReturnType<typeof asAllEvents>
export const asAllEvents = asUnion(
  asMessageEvent,
  asErrorEvent,
  asReadyEvent,
  asUpdateEvent,
  asCheckEvent,
  asRepoSyncEvent,
  asServerSyncEvent,
  asNetworkSyncEvent
)
