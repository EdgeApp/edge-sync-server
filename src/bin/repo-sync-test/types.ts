import {
  asArray,
  asEither,
  asMap,
  asNumber,
  asObject,
  asString,
  asValue
} from 'cleaners'

export interface ErrorObj extends Error {
  [key: string]: any
}
export const asErrorObj = (raw: any): ErrorObj => {
  const clean = asObject({
    name: asString,
    message: asString,
    stack: asString
  }).withRest(raw)
  const out: ErrorObj = new Error(clean.message)
  out.message = clean.message
  out.stack = clean.stack
  out.name = clean.name
  Object.entries(clean).forEach(function ([key, value]) {
    out[key] = value
  })
  return out
}

// Shared error output type
export type ErrorEvent = ReturnType<typeof asErrorEvent>
export const asErrorEvent = asObject({
  type: asValue('error'),
  process: asString,
  err: asErrorObj
})

export type MessageEvent = ReturnType<typeof asMessageEvent>
export const asMessageEvent = asObject({
  type: asValue('message'),
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
  type: asValue('ready'),
  serverHost: asString,
  syncKey: asString,
  requestTime: asNumber,
  serverRepoHash: asString
})

export type UpdateEvent = ReturnType<typeof asUpdateEvent>
export const asUpdateEvent = asObject({
  type: asValue('update'),
  serverHost: asString,
  syncKey: asString,
  requestTime: asNumber,
  serverRepoHash: asString,
  payloadSize: asNumber
})

export type CheckEvent = ReturnType<typeof asCheckEvent>
export const asCheckEvent = asObject({
  type: asValue('check'),
  serverHost: asString,
  syncKey: asString,
  requestTime: asNumber,
  serverRepoHash: asString
})

export type ReplicationEvent = ReturnType<typeof asReplicationEvent>
export const asReplicationEvent = asObject({
  type: asValue('replication'),
  timestamp: asNumber,
  syncKey: asString,
  serverHost: asString
})

export type RepoSyncEvent = ReturnType<typeof asRepoSyncEvent>
export const asRepoSyncEvent = asObject({
  type: asValue('repo-sync'),
  timestamp: asNumber,
  syncKey: asString
})

export type ServerSyncEvent = ReturnType<typeof asServerSyncEvent>
export const asServerSyncEvent = asObject({
  type: asValue('server-sync'),
  timestamp: asNumber,
  serverHost: asString
})

export type NetworkSyncEvent = ReturnType<typeof asNetworkSyncEvent>
export const asNetworkSyncEvent = asObject({
  type: asValue('network-sync'),
  timestamp: asNumber
})

// Unions

export type AllEvents = ReturnType<typeof asAllEvents>
export const asAllEvents = asEither(
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
