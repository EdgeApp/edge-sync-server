import nano from 'nano'

/**
 * Callbacks a change source reports to. The source never throws; every
 * failure arrives through `onError`.
 */
export interface ChangeSourceHandlers {
  /** The document IDs from one completed poll that had changes. */
  onChanges: (docIds: string[]) => void
  /** A poll completed, with or without changes. Feeds the watchdog. */
  onPoll: () => void
  onError: (error: unknown) => void
}

/**
 * A running feed of document changes. Stopping it guarantees no further
 * callbacks, even from a request that is still in flight.
 */
export interface ChangeSource {
  stop: () => void
  /** The sequence to resume from when this source is replaced. */
  readonly since: string
}

export type MakeChangeSource = (
  handlers: ChangeSourceHandlers,
  since: string
) => ChangeSource

interface ChangesResponse {
  results: Array<{ id: string }>
  last_seq: string
}

export interface CouchChangeSourceOptions {
  couchUri: string
  databaseName: string
  /** Longpoll timeout for each request, in milliseconds. */
  timeoutMs: number
  batchSize?: number
}

const MIN_RETRY_MS = 1000
const MAX_RETRY_MS = 60000

/**
 * Reads a database's `_changes` feed with `feed=longpoll` and
 * `include_docs=false`, one request at a time, backing off exponentially to
 * 60 seconds on failure. Every completed request reports `onPoll`, including
 * one that times out with no changes, which is what lets a watchdog tell an
 * idle feed from a wedged one.
 */
export const makeCouchChangeSource = (
  options: CouchChangeSourceOptions
): MakeChangeSource => {
  const { couchUri, databaseName, timeoutMs, batchSize = 100 } = options
  const server = nano({
    url: couchUri,
    // A request that outlives its longpoll is wedged; fail it so the loop
    // retries instead of waiting on the watchdog.
    requestDefaults: { timeout: timeoutMs + 30000 }
  })

  return (handlers, initialSince) => {
    let since = initialSince
    // An object, so the loop sees `stop()` flip it between awaits:
    const state = { running: true }
    let retryMs = 0
    let wakeUp: (() => void) | undefined
    let sleepTimer: ReturnType<typeof setTimeout> | undefined

    const sleep = async (ms: number): Promise<void> =>
      await new Promise(resolve => {
        wakeUp = resolve
        sleepTimer = setTimeout(() => resolve(), ms)
      })

    const loop = async (): Promise<void> => {
      while (state.running) {
        try {
          const response: ChangesResponse = await server.request({
            db: databaseName,
            path: '_changes',
            qs: {
              feed: 'longpoll',
              since,
              timeout: timeoutMs,
              limit: batchSize,
              include_docs: false
            }
          })
          if (!state.running) return
          retryMs = 0
          since = response.last_seq
          handlers.onPoll()
          if (response.results.length > 0) {
            handlers.onChanges(response.results.map(result => result.id))
          }
        } catch (error) {
          if (!state.running) return
          handlers.onError(error)
          retryMs = Math.min(
            MAX_RETRY_MS,
            retryMs === 0 ? MIN_RETRY_MS : retryMs * 2
          )
          await sleep(retryMs)
        }
      }
    }

    loop().catch(error => {
      if (state.running) handlers.onError(error)
    })

    return {
      get since() {
        return since
      },
      stop() {
        state.running = false
        if (sleepTimer != null) clearTimeout(sleepTimer)
        if (wakeUp != null) wakeUp()
      }
    }
  }
}

/**
 * Extracts the repo ID from a store document ID. Store documents live in a
 * partitioned database under `${repoId}:${path}`, so the partition prefix is
 * the repo ID. Returns undefined for design documents and anything else
 * without a partition.
 */
export const docIdToRepoId = (docId: string): string | undefined => {
  const colon = docId.indexOf(':')
  if (colon <= 0 || docId.startsWith('_')) return undefined
  return docId.slice(0, colon)
}
