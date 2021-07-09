import { asEither, asNumber, asObject, asString, asValue } from 'cleaners'

import { asErrorObj } from './error-obj'

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

export type ReadEvent = ReturnType<typeof asReadEvent>
export const asReadEvent = asObject({
  type: asValue('read'),
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

// Union of all events
export type AllEvents = ReturnType<typeof asAllEvents>
export const asAllEvents = asEither(
  asMessageEvent,
  asErrorEvent,
  asReadyEvent,
  asUpdateEvent,
  asReadEvent,
  asReplicationEvent,
  asRepoSyncEvent,
  asServerSyncEvent,
  asNetworkSyncEvent
)
