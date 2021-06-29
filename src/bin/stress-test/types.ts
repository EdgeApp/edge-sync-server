import {
  asArray,
  asMap,
  asNumber,
  asObject,
  asString,
  asUnknown,
  Cleaner
} from 'cleaners'

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

// Configs

export type WorkerConfig = ReturnType<typeof asWorkerConfig>
export const asWorkerConfig = asObject({
  clusters: asMap(asArray(asString)),
  syncKey: asString,
  repoUpdatesPerMin: asNumber,
  repoReadsPerMin: asNumber,
  repoCheckDelayInSeconds: asNumber,
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
  syncKey: asString,
  requestTime: asNumber,
  serverRepoHash: asString
})

export type UpdateEvent = ReturnType<typeof asUpdateEvent>
export const asUpdateEvent = asObject({
  type: asLiteral('update'),
  serverHost: asString,
  syncKey: asString,
  requestTime: asNumber,
  serverRepoHash: asString,
  payloadSize: asNumber
})

export type CheckEvent = ReturnType<typeof asCheckEvent>
export const asCheckEvent = asObject({
  type: asLiteral('check'),
  serverHost: asString,
  syncKey: asString,
  requestTime: asNumber,
  serverRepoHash: asString
})

export type ReplicationEvent = ReturnType<typeof asReplicationEvent>
export const asReplicationEvent = asObject({
  type: asLiteral('replication'),
  timestamp: asNumber,
  syncKey: asString,
  serverHost: asString
})

export type RepoSyncEvent = ReturnType<typeof asRepoSyncEvent>
export const asRepoSyncEvent = asObject({
  type: asLiteral('repo-sync'),
  timestamp: asNumber,
  syncKey: asString
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
  asReplicationEvent,
  asRepoSyncEvent,
  asServerSyncEvent,
  asNetworkSyncEvent
)
