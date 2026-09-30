import { Checkpoint, wasCheckpoint } from '../types/checkpoints'
import { ChangeSource, docIdToRepoId, MakeChangeSource } from './changeSource'

export type WorkerKey = string | number

/** A repo ID and its current checkpoint, as sent to workers. */
export type RepoUpdate = [repoId: string, checkpoint: string]

export interface RepoChangeEngineOptions {
  makeSource: MakeChangeSource
  /** Reads a repo's current checkpoint. May throw; the repo is retried. */
  getCheckpoint: (repoId: string) => Promise<Checkpoint>
  /** Sends one worker the updates it registered interest in. */
  deliver: (worker: WorkerKey, updates: RepoUpdate[]) => void
  /** Called once the watchdog gives up on the feed. */
  onFatal: (reason: string) => void
  log: {
    info: (message: string) => void
    warn: (message: string) => void
    error: (message: string, error?: unknown) => void
  }
  /** Changes to a repo are merged for this long before its checkpoint read. */
  coalesceMs: number
  /** The feed's longpoll timeout. The watchdog checks at this interval. */
  feedTimeoutMs: number
  /** Watchdog restarts without a completed poll before `onFatal`. */
  maxRestarts: number
  /** Checkpoint reads in flight at once. */
  checkpointConcurrency?: number
}

export interface RepoChangeEngine {
  start: () => void
  stop: () => void
  addInterest: (worker: WorkerKey, repoIds: string[]) => void
  removeInterest: (worker: WorkerKey, repoIds: string[]) => void
  removeWorker: (worker: WorkerKey) => void
  stats: () => { repos: number; workers: number; restarts: number }
}

/**
 * The always-running listener behind WebSocket repo subscriptions. It owns the
 * single change feed for this host and the registry of which workers watch
 * which repos. Changes to unwatched repos are discarded on arrival. Changes to
 * a watched repo are merged over `coalesceMs`, then one checkpoint read serves
 * every worker watching that repo.
 *
 * Workers receive only the repos they registered; there is no broadcast.
 *
 * A watchdog replaces the feed when no poll has completed for two longpoll
 * timeouts, resuming from the last sequence it saw so nothing is skipped.
 * After `maxRestarts` consecutive replacements with no completed poll, it
 * reports `onFatal`, because a host whose feed is dead serves subscriptions
 * that never fire.
 */
export const makeRepoChangeEngine = (
  options: RepoChangeEngineOptions
): RepoChangeEngine => {
  const {
    makeSource,
    getCheckpoint,
    deliver,
    onFatal,
    log,
    coalesceMs,
    feedTimeoutMs,
    maxRestarts,
    checkpointConcurrency = 10
  } = options

  const reposToWorkers = new Map<string, Set<WorkerKey>>()
  const workersToRepos = new Map<WorkerKey, Set<string>>()

  let source: ChangeSource | undefined
  let running = false
  let lastPollAt = 0
  let restarts = 0
  let watchdog: ReturnType<typeof setInterval> | undefined

  // Repos waiting for the current coalescing window to close:
  let pending = new Set<string>()
  let windowTimer: ReturnType<typeof setTimeout> | undefined
  // Windows run one at a time, so a worker never sees an older checkpoint
  // for a repo after a newer one:
  let flushing = false

  const handleChanges = (docIds: string[]): void => {
    for (const docId of docIds) {
      const repoId = docIdToRepoId(docId)
      if (repoId == null || !reposToWorkers.has(repoId)) continue
      pending.add(repoId)
    }
    scheduleWindow()
  }

  const scheduleWindow = (): void => {
    if (windowTimer != null || flushing || pending.size === 0 || !running) {
      return
    }
    windowTimer = setTimeout(() => {
      windowTimer = undefined
      flushing = true
      flushWindow()
        .catch(error => log.error('Repo change window failed', error))
        .finally(() => {
          flushing = false
          scheduleWindow()
        })
    }, coalesceMs)
  }

  const flushWindow = async (): Promise<void> => {
    const repoIds = [...pending].filter(repoId => reposToWorkers.has(repoId))
    pending = new Set()

    const byWorker = new Map<WorkerKey, RepoUpdate[]>()
    const failed: string[] = []

    const readOne = async (repoId: string): Promise<void> => {
      let checkpoint: Checkpoint
      try {
        checkpoint = await getCheckpoint(repoId)
      } catch (error) {
        failed.push(repoId)
        log.warn(`Checkpoint read failed for ${repoId}: ${String(error)}`)
        return
      }
      const workers = reposToWorkers.get(repoId)
      if (workers == null) return
      const update: RepoUpdate = [repoId, wasCheckpoint(checkpoint) as string]
      for (const worker of workers) {
        const list = byWorker.get(worker)
        if (list == null) byWorker.set(worker, [update])
        else list.push(update)
      }
    }

    for (let i = 0; i < repoIds.length; i += checkpointConcurrency) {
      await Promise.all(
        repoIds.slice(i, i + checkpointConcurrency).map(readOne)
      )
    }

    if (!running) return
    for (const [worker, updates] of byWorker) {
      try {
        deliver(worker, updates)
      } catch (error) {
        log.error(`Delivery to worker ${String(worker)} failed`, error)
      }
    }

    // A repo whose checkpoint could not be read still changed. Retry it in
    // the next window rather than dropping the notification.
    for (const repoId of failed) pending.add(repoId)
  }

  const startSource = (since: string): void => {
    source = makeSource(
      {
        onChanges: handleChanges,
        onPoll() {
          lastPollAt = Date.now()
          restarts = 0
        },
        onError(error) {
          log.warn(`Change feed error: ${String(error)}`)
        }
      },
      since
    )
  }

  const checkWatchdog = (): void => {
    if (!running || source == null) return
    if (Date.now() - lastPollAt < 2 * feedTimeoutMs) return

    restarts += 1
    if (restarts > maxRestarts) {
      running = false
      stopAll()
      onFatal(`Change feed has not completed a poll in ${maxRestarts} restarts`)
      return
    }
    log.warn(
      `Change feed has not completed a poll; restarting it (${restarts}/${maxRestarts})`
    )
    const since = source.since
    source.stop()
    // Give the replacement a full deadline before judging it:
    lastPollAt = Date.now()
    startSource(since)
  }

  const removeInterest = (worker: WorkerKey, repoIds: string[]): void => {
    const repos = workersToRepos.get(worker)
    for (const repoId of repoIds) {
      repos?.delete(repoId)
      const workers = reposToWorkers.get(repoId)
      if (workers == null) continue
      workers.delete(worker)
      if (workers.size === 0) reposToWorkers.delete(repoId)
    }
    if (repos != null && repos.size === 0) workersToRepos.delete(worker)
  }

  const stopAll = (): void => {
    if (watchdog != null) clearInterval(watchdog)
    if (windowTimer != null) clearTimeout(windowTimer)
    watchdog = undefined
    windowTimer = undefined
    source?.stop()
    source = undefined
  }

  return {
    start() {
      if (running) return
      running = true
      lastPollAt = Date.now()
      restarts = 0
      startSource('now')
      watchdog = setInterval(checkWatchdog, feedTimeoutMs)
      log.info('Repo change engine started')
    },

    stop() {
      running = false
      stopAll()
    },

    addInterest(worker, repoIds) {
      let repos = workersToRepos.get(worker)
      if (repos == null) {
        repos = new Set()
        workersToRepos.set(worker, repos)
      }
      for (const repoId of repoIds) {
        repos.add(repoId)
        const workers = reposToWorkers.get(repoId)
        if (workers == null) reposToWorkers.set(repoId, new Set([worker]))
        else workers.add(worker)
      }
    },

    removeInterest,

    removeWorker(worker) {
      const repos = workersToRepos.get(worker)
      if (repos != null) removeInterest(worker, [...repos])
    },

    stats() {
      return {
        repos: reposToWorkers.size,
        workers: workersToRepos.size,
        restarts
      }
    }
  }
}
