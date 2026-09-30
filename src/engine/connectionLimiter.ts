import {
  asBoolean,
  asEither,
  asNumber,
  asObject,
  asString,
  asValue
} from 'cleaners'

import { WorkerKey } from './repoChangeEngine'

/**
 * Counts open sockets per client IP across the whole host, so the per-IP
 * cap means the same thing however many workers the host forks.
 */
export interface ConnectionLimiter {
  /** Resolves true and holds a slot if the IP is under the cap. */
  reserve: (ip: string) => Promise<boolean>
  release: (ip: string) => void
}

/**
 * The host-wide counter, kept wherever every socket can reach it: the
 * cluster master, or the process itself when there is no cluster.
 */
export interface ConnectionCounter {
  reserve: (worker: WorkerKey, ip: string) => boolean
  release: (worker: WorkerKey, ip: string) => void
  /** Frees every slot a dead worker held. */
  removeWorker: (worker: WorkerKey) => void
  count: (ip: string) => number
}

export const makeConnectionCounter = (maxPerIp: number): ConnectionCounter => {
  const perIp = new Map<string, number>()
  const perWorker = new Map<WorkerKey, Map<string, number>>()

  const adjust = (map: Map<string, number>, ip: string, by: number): void => {
    const next = (map.get(ip) ?? 0) + by
    if (next <= 0) map.delete(ip)
    else map.set(ip, next)
  }

  return {
    reserve(worker, ip) {
      if ((perIp.get(ip) ?? 0) >= maxPerIp) return false
      adjust(perIp, ip, 1)
      let held = perWorker.get(worker)
      if (held == null) {
        held = new Map()
        perWorker.set(worker, held)
      }
      adjust(held, ip, 1)
      return true
    },
    release(worker, ip) {
      const held = perWorker.get(worker)
      if (held == null || !held.has(ip)) return
      adjust(held, ip, -1)
      adjust(perIp, ip, -1)
    },
    removeWorker(worker) {
      const held = perWorker.get(worker)
      if (held == null) return
      for (const [ip, count] of held) adjust(perIp, ip, -count)
      perWorker.delete(worker)
    },
    count(ip) {
      return perIp.get(ip) ?? 0
    }
  }
}

/** A limiter backed by a counter in the same process. */
export const makeLocalConnectionLimiter = (
  counter: ConnectionCounter,
  worker: WorkerKey = 'local'
): ConnectionLimiter => ({
  async reserve(ip) {
    return counter.reserve(worker, ip)
  },
  release(ip) {
    counter.release(worker, ip)
  }
})

//
// Cluster IPC
//

/** Worker → master */
export type LimiterRequest =
  | { wsConn: 'reserve'; id: number; ip: string }
  | { wsConn: 'release'; ip: string }

/** Master → worker */
export interface LimiterReply {
  wsConn: 'reserved'
  id: number
  ok: boolean
}

export const asLimiterRequest = asEither(
  asObject({ wsConn: asValue('reserve'), id: asNumber, ip: asString }),
  asObject({ wsConn: asValue('release'), ip: asString })
)

const asLimiterReply = asObject({
  wsConn: asValue('reserved'),
  id: asNumber,
  ok: asBoolean
})

interface IpcProcess {
  send?: (message: unknown) => unknown
  on: (event: 'message', listener: (message: unknown) => void) => unknown
}

/**
 * A limiter whose counter lives in the cluster master. A reservation the
 * master does not answer within `timeoutMs` is refused: a worker that cannot
 * reach its master cannot serve subscriptions either.
 */
export const makeIpcConnectionLimiter = (
  proc: IpcProcess = process,
  timeoutMs: number = 2000
): ConnectionLimiter => {
  let nextId = 1
  const waiting = new Map<number, (ok: boolean) => void>()

  proc.on('message', raw => {
    let reply: LimiterReply
    try {
      reply = asLimiterReply(raw)
    } catch (error) {
      return // Not ours
    }
    waiting.get(reply.id)?.(reply.ok)
  })

  return {
    async reserve(ip) {
      if (proc.send == null) return false
      const id = nextId++
      return await new Promise<boolean>(resolve => {
        const timer = setTimeout(() => {
          waiting.delete(id)
          resolve(false)
        }, timeoutMs)
        waiting.set(id, ok => {
          clearTimeout(timer)
          waiting.delete(id)
          resolve(ok)
        })
        try {
          proc.send?.({ wsConn: 'reserve', id, ip })
        } catch (error) {
          clearTimeout(timer)
          waiting.delete(id)
          resolve(false)
        }
      })
    },
    release(ip) {
      try {
        proc.send?.({ wsConn: 'release', ip })
      } catch (error) {
        // The master is gone, and its counts with it.
      }
    }
  }
}
