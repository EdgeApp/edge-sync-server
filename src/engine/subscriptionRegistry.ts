import { asMaybe } from 'cleaners'

import { asCheckpoint, Checkpoint, wasCheckpoint } from '../types/checkpoints'
import { asRepoId } from '../types/repo-id'
import { equalCheckpoints } from '../util/store/checkpoints'
import { ChangeHub, RepoSubscriber } from './changeHub'

/**
 * -1: the entry is not subscribable (a malformed repo ID or checkpoint)
 *  0: the subscription failed; the client should keep polling this repo
 *  1: subscribed, and the repo matches the client's checkpoint
 *  2: subscribed, and the repo has changes the client should pull
 */
export type SubscribeResult = -1 | 0 | 1 | 2

export interface SubscriptionRegistryOptions {
  hub: ChangeHub
  getCheckpoint: (repoId: string) => Promise<Checkpoint>
  /** Sends one `update` notification to the client. */
  sendUpdate: (updates: Array<[repoId: string, checkpoint: string]>) => void
  /** Sends one `subLost` notification to the client. */
  sendSubLost: (repoIds: Array<[repoId: string]>) => void
  maxSubscriptions: number
}

export interface SubscriptionRegistry extends RepoSubscriber {
  subscribe: (
    params: Array<[repoId: unknown, checkpoint?: unknown]>
  ) => Promise<SubscribeResult[]>
  /** Delivers updates that arrived while `subscribe` was answering. */
  flushQueued: () => void
  unsubscribe: (repoIds: unknown[]) => void
  /** Tells the client every subscription is gone, then closes. */
  loseAll: () => void
  close: () => void
  size: () => number
}

interface Entry {
  /** The newest checkpoint the client is known to have been told about. */
  known: Checkpoint
  /** True while a subscribe call is still answering for this repo. */
  answering: boolean
  /** The newest update that arrived while answering. */
  queued?: Checkpoint
}

/**
 * One socket's subscriptions. It compares engine updates against what this
 * client already knows and never touches CouchDB on the notify path; the
 * only reads are the checkpoint reads a `subscribe` call answers with.
 */
export const makeSubscriptionRegistry = (
  options: SubscriptionRegistryOptions
): SubscriptionRegistry => {
  const {
    hub,
    getCheckpoint,
    sendUpdate,
    sendSubLost,
    maxSubscriptions
  } = options
  const entries = new Map<string, Entry>()
  let closed = false

  const notify = (updates: Array<[string, Checkpoint]>): void => {
    const out: Array<[string, string]> = []
    for (const [repoId, checkpoint] of updates) {
      const entry = entries.get(repoId)
      if (entry == null) continue
      if (entry.answering) {
        entry.queued = checkpoint
        continue
      }
      if (equalCheckpoints(entry.known, checkpoint)) continue
      entry.known = checkpoint
      out.push([repoId, wasCheckpoint(checkpoint) as string])
    }
    if (out.length > 0 && !closed) sendUpdate(out)
  }

  const drop = (repoIds: string[]): void => {
    for (const repoId of repoIds) entries.delete(repoId)
    hub.unwatch(registry, repoIds)
  }

  const registry: SubscriptionRegistry = {
    handleUpdates: notify,

    async subscribe(params) {
      const results: SubscribeResult[] = params.map(() => -1)
      const claimed: Array<{
        index: number
        repoId: string
        client: Checkpoint
      }> = []
      const added: string[] = []

      params.forEach(([rawRepoId, rawCheckpoint], index) => {
        const repoId = asMaybe(asRepoId)(rawRepoId)
        const client =
          rawCheckpoint == null
            ? { version: 0, sum: 0 }
            : asMaybe(asCheckpoint)(rawCheckpoint)
        if (repoId == null || client == null) return // -1

        const entry = entries.get(repoId)
        if (entry == null) {
          if (entries.size >= maxSubscriptions) {
            results[index] = 0
            return
          }
          entries.set(repoId, { known: client, answering: true })
          added.push(repoId)
        } else {
          entry.answering = true
        }
        claimed.push({ index, repoId, client })
      })

      let watched = claimed
      try {
        await hub.watch(registry, added)
      } catch (error) {
        // The hub has already forgotten these; repos this socket held
        // before the call are still watched and answer normally.
        const failed = new Set(added)
        for (const repoId of failed) entries.delete(repoId)
        watched = []
        for (const claim of claimed) {
          if (failed.has(claim.repoId)) results[claim.index] = 0
          else watched.push(claim)
        }
      }

      // Only now is every repo watched, so any write after these reads
      // reaches this socket as an update.
      const reads = new Map<string, Promise<Checkpoint>>()
      await Promise.all(
        watched.map(async ({ index, repoId, client }) => {
          let read = reads.get(repoId)
          if (read == null) {
            read = getCheckpoint(repoId)
            reads.set(repoId, read)
          }
          const entry = entries.get(repoId)
          try {
            const server = await read
            if (entry == null) return // Unsubscribed while reading
            if (equalCheckpoints(server, client)) {
              entry.known = client
              results[index] = 1
            } else {
              entry.known = server
              results[index] = 2
            }
          } catch (error) {
            // "Could not check" must never look like "no changes": with
            // polling off, the client trusts 1 absolutely.
            results[index] = 0
            if (entry != null) drop([repoId])
          }
        })
      )
      if (closed) return params.map(() => 0)
      return results
    },

    flushQueued() {
      const queued: Array<[string, Checkpoint]> = []
      for (const [repoId, entry] of entries) {
        if (!entry.answering) continue
        entry.answering = false
        if (entry.queued != null) queued.push([repoId, entry.queued])
        entry.queued = undefined
      }
      notify(queued)
    },

    unsubscribe(repoIds) {
      const known: string[] = []
      for (const raw of repoIds) {
        const repoId = asMaybe(asRepoId)(raw)
        if (repoId != null && entries.has(repoId)) known.push(repoId)
      }
      drop(known)
    },

    loseAll() {
      const repoIds = [...entries.keys()]
      if (repoIds.length > 0 && !closed) {
        sendSubLost(repoIds.map(repoId => [repoId]))
      }
      registry.close()
    },

    close() {
      if (closed) return
      closed = true
      drop([...entries.keys()])
    },

    size() {
      return entries.size
    }
  }
  return registry
}
