import {
  asArray,
  asEither,
  asNumber,
  asObject,
  asString,
  asValue,
  Cleaner
} from 'cleaners'

import { asCheckpoint, Checkpoint } from '../types/checkpoints'
import { RepoChangeEngine, RepoUpdate, WorkerKey } from './repoChangeEngine'

/** Anything that holds repo subscriptions, i.e. one socket's registry. */
export interface RepoSubscriber {
  handleUpdates: (
    updates: Array<[repoId: string, checkpoint: Checkpoint]>
  ) => void
}

/**
 * The worker's view of the change engine. It reference-counts interest
 * across every socket in the worker, so the engine hears about a repo once,
 * when the first socket watches it and when the last one stops.
 */
export interface ChangeHub {
  /**
   * Resolves once the engine is watching every repo in `repoIds`. A
   * subscriber must not read a checkpoint before this resolves, or a write
   * landing between the read and the registration goes unnotified.
   */
  watch: (subscriber: RepoSubscriber, repoIds: string[]) => Promise<void>
  unwatch: (subscriber: RepoSubscriber, repoIds: string[]) => void
  /** Every subscriber, for broadcasting `subLost`. */
  subscribers: () => RepoSubscriber[]
  stats: () => { repos: number }
}

/** The transport between a worker's hub and the engine. */
export interface HubLink {
  addInterest: (repoIds: string[]) => Promise<void>
  removeInterest: (repoIds: string[]) => void
  onUpdates: (callback: (updates: RepoUpdate[]) => void) => void
}

interface RepoEntry {
  subscribers: Set<RepoSubscriber>
  ready: Promise<void>
}

export const makeChangeHub = (link: HubLink): ChangeHub => {
  const repos = new Map<string, RepoEntry>()

  link.onUpdates(updates => {
    const bySubscriber = new Map<RepoSubscriber, Array<[string, Checkpoint]>>()
    for (const [repoId, checkpointString] of updates) {
      const entry = repos.get(repoId)
      if (entry == null) continue
      const checkpoint = asCheckpoint(checkpointString)
      for (const subscriber of entry.subscribers) {
        const list = bySubscriber.get(subscriber)
        if (list == null) bySubscriber.set(subscriber, [[repoId, checkpoint]])
        else list.push([repoId, checkpoint])
      }
    }
    for (const [subscriber, list] of bySubscriber) {
      subscriber.handleUpdates(list)
    }
  })

  return {
    async watch(subscriber, repoIds) {
      const fresh: string[] = []
      const waits: Array<Promise<void>> = []
      let freshReady: Promise<void> | undefined

      for (const repoId of new Set(repoIds)) {
        const entry = repos.get(repoId)
        if (entry != null) {
          entry.subscribers.add(subscriber)
          waits.push(entry.ready)
          continue
        }
        fresh.push(repoId)
      }

      if (fresh.length > 0) {
        freshReady = link.addInterest(fresh)
        // Nothing awaits this copy; it only keeps a rejection handled when no
        // later subscriber joins these repos.
        freshReady.catch(() => {})
        for (const repoId of fresh) {
          repos.set(repoId, {
            subscribers: new Set([subscriber]),
            ready: freshReady
          })
        }
        waits.push(freshReady)
      }

      try {
        await Promise.all(waits)
      } catch (error) {
        // The engine never confirmed these repos. Forget them, so the next
        // subscriber asks again instead of trusting a registration that may
        // not exist.
        for (const repoId of repoIds) {
          const entry = repos.get(repoId)
          if (entry == null) continue
          entry.subscribers.delete(subscriber)
          if (entry.subscribers.size === 0) {
            repos.delete(repoId)
            link.removeInterest([repoId])
          }
        }
        throw error
      }
    },

    unwatch(subscriber, repoIds) {
      const dropped: string[] = []
      for (const repoId of new Set(repoIds)) {
        const entry = repos.get(repoId)
        if (entry == null || !entry.subscribers.delete(subscriber)) continue
        if (entry.subscribers.size === 0) {
          repos.delete(repoId)
          dropped.push(repoId)
        }
      }
      if (dropped.length > 0) link.removeInterest(dropped)
    },

    subscribers() {
      const out = new Set<RepoSubscriber>()
      for (const entry of repos.values()) {
        for (const subscriber of entry.subscribers) out.add(subscriber)
      }
      return [...out]
    },

    stats() {
      return { repos: repos.size }
    }
  }
}

/**
 * Connects a hub to an engine in the same process. Used by the tests and
 * anywhere a single process owns both the feed and the sockets.
 */
export const makeLocalHubLink = (
  engine: RepoChangeEngine,
  worker: WorkerKey = 'local'
): HubLink & { deliver: (updates: RepoUpdate[]) => void } => {
  let callback: (updates: RepoUpdate[]) => void = () => {}
  return {
    async addInterest(repoIds) {
      engine.addInterest(worker, repoIds)
    },
    removeInterest(repoIds) {
      engine.removeInterest(worker, repoIds)
    },
    onUpdates(cb) {
      callback = cb
    },
    deliver(updates) {
      callback(updates)
    }
  }
}

//
// Cluster IPC
//

/** Worker → master */
export type HubRequest =
  | { wsHub: 'watch'; id: number; repoIds: string[] }
  | { wsHub: 'unwatch'; repoIds: string[] }

/** Master → worker */
export type HubReply =
  | { wsHub: 'ack'; id: number }
  | { wsHub: 'updates'; updates: RepoUpdate[] }

const asRepoUpdate: Cleaner<RepoUpdate> = raw => {
  const [repoId, checkpoint] = asArray(asString)(raw)
  if (repoId == null || checkpoint == null) throw new TypeError('Expected pair')
  return [repoId, checkpoint]
}

export const asHubRequest: Cleaner<HubRequest> = asEither(
  asObject({
    wsHub: asValue('watch'),
    id: asNumber,
    repoIds: asArray(asString)
  }),
  asObject({ wsHub: asValue('unwatch'), repoIds: asArray(asString) })
)

export const asHubReply: Cleaner<HubReply> = asEither(
  asObject({ wsHub: asValue('ack'), id: asNumber }),
  asObject({ wsHub: asValue('updates'), updates: asArray(asRepoUpdate) })
)

interface IpcProcess {
  send?: (message: unknown) => unknown
  on: (event: 'message', listener: (message: unknown) => void) => unknown
}

/**
 * Connects a worker's hub to the engine in the cluster master. `addInterest`
 * rejects if the master does not acknowledge within `ackTimeoutMs`.
 */
export const makeIpcHubLink = (
  proc: IpcProcess = process,
  ackTimeoutMs: number = 5000
): HubLink => {
  let nextId = 1
  let callback: (updates: RepoUpdate[]) => void = () => {}
  const waiting = new Map<number, () => void>()

  const send = (message: HubRequest): void => {
    if (proc.send == null) throw new Error('No IPC channel to the master')
    proc.send(message)
  }

  proc.on('message', raw => {
    let reply: HubReply
    try {
      reply = asHubReply(raw)
    } catch (error) {
      return // Not ours
    }
    if (reply.wsHub === 'ack') waiting.get(reply.id)?.()
    else callback(reply.updates)
  })

  return {
    async addInterest(repoIds) {
      const id = nextId++
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.delete(id)
          reject(new Error('The change engine did not acknowledge interest'))
        }, ackTimeoutMs)
        waiting.set(id, () => {
          clearTimeout(timer)
          waiting.delete(id)
          resolve()
        })
        try {
          send({ wsHub: 'watch', id, repoIds })
        } catch (error) {
          clearTimeout(timer)
          waiting.delete(id)
          reject(error)
        }
      })
    },
    removeInterest(repoIds) {
      try {
        send({ wsHub: 'unwatch', repoIds })
      } catch (error) {
        // The master is gone; it has no interest left to remove.
      }
    },
    onUpdates(cb) {
      callback = cb
    }
  }
}
