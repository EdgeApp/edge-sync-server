import { expect } from 'chai'
import { describe, it } from 'mocha'

import { ChangeSourceHandlers } from '../../src/engine/changeSource'
import {
  makeRepoChangeEngine,
  RepoChangeEngineOptions,
  RepoUpdate,
  WorkerKey
} from '../../src/engine/repoChangeEngine'
import { Checkpoint } from '../../src/types/checkpoints'
import { delay } from '../utils'

interface FakeFeed {
  handlers: ChangeSourceHandlers
  since: string
  stopped: boolean
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const makeHarness = (overrides: Partial<RepoChangeEngineOptions> = {}) => {
  const feeds: FakeFeed[] = []
  const delivered: Array<[WorkerKey, RepoUpdate[]]> = []
  const reads: string[] = []
  const fatal: string[] = []
  const checkpoints = new Map<string, Checkpoint>()

  const engine = makeRepoChangeEngine({
    makeSource(handlers, since) {
      const feed: FakeFeed = { handlers, since, stopped: false }
      feeds.push(feed)
      return {
        get since() {
          return feed.since
        },
        stop() {
          feed.stopped = true
        }
      }
    },
    async getCheckpoint(repoId) {
      reads.push(repoId)
      return checkpoints.get(repoId) ?? { version: 0, sum: 0 }
    },
    deliver(worker, updates) {
      delivered.push([worker, updates])
    },
    onFatal(reason) {
      fatal.push(reason)
    },
    log: { info() {}, warn() {}, error() {} },
    coalesceMs: 20,
    feedTimeoutMs: 1000,
    maxRestarts: 10,
    ...overrides
  })
  const feed = (): FakeFeed => feeds[feeds.length - 1]
  const emit = (...docIds: string[]): void => {
    feed().handlers.onPoll()
    feed().handlers.onChanges(docIds)
  }
  return { engine, feeds, feed, emit, delivered, reads, fatal, checkpoints }
}

describe('Unit: repoChangeEngine', () => {
  it('delivers a change to every worker watching the repo', async () => {
    const h = makeHarness()
    h.engine.start()
    h.engine.addInterest(1, ['repoA'])
    h.engine.addInterest(2, ['repoA'])
    h.checkpoints.set('repoA', { version: 2, sum: 3 })

    h.emit('repoA:file.json')
    await delay(60)

    expect(h.delivered).deep.equals([
      [1, [['repoA', '2:3']]],
      [2, [['repoA', '2:3']]]
    ])
    h.engine.stop()
  })

  it('does not deliver changes to repos nobody watches', async () => {
    const h = makeHarness()
    h.engine.start()
    h.engine.addInterest(1, ['repoA'])

    h.emit('repoB:file.json', '_design/versioning', 'nopartition')
    await delay(60)

    expect(h.delivered).deep.equals([])
    expect(h.reads).deep.equals([])
    h.engine.stop()
  })

  it('merges a burst into one checkpoint read and one delivery', async () => {
    const h = makeHarness()
    h.engine.start()
    h.engine.addInterest(1, ['repoA', 'repoB'])

    const docs: string[] = []
    for (let i = 0; i < 40; ++i) docs.push(`repoA:file${i}.json`)
    h.emit(...docs)
    h.emit('repoB:x.json')
    h.emit('repoA:late.json')
    await delay(60)

    expect(h.reads.sort((x, y) => x.localeCompare(y))).deep.equals([
      'repoA',
      'repoB'
    ])
    expect(h.delivered.length).equals(1)
    expect(
      h.delivered[0][1].map(([id]) => id).sort((x, y) => x.localeCompare(y))
    ).deep.equals(['repoA', 'repoB'])
    h.engine.stop()
  })

  it('survives a feed error', async () => {
    const h = makeHarness()
    h.engine.start()
    h.engine.addInterest(1, ['repoA'])
    h.feed().handlers.onError(new Error('boom'))
    h.emit('repoA:1')
    await delay(60)
    expect(h.delivered.length).equals(1)
    h.engine.stop()
  })

  it('retries a repo whose checkpoint read failed', async () => {
    let failures = 1
    const h = makeHarness({
      async getCheckpoint() {
        if (failures-- > 0) throw new Error('couch down')
        return { version: 5, sum: 9 }
      }
    })
    h.engine.start()
    h.engine.addInterest(1, ['repoA'])
    h.emit('repoA:1')
    await delay(100)
    expect(h.delivered).deep.equals([[1, [['repoA', '5:9']]]])
    h.engine.stop()
  })

  it('forgets interest when the last watcher leaves or its worker dies', () => {
    const h = makeHarness()
    h.engine.addInterest(1, ['repoA', 'repoB'])
    h.engine.addInterest(2, ['repoA'])
    h.engine.removeInterest(1, ['repoA'])
    expect(h.engine.stats()).deep.includes({ repos: 2, workers: 2 })
    h.engine.removeWorker(2)
    expect(h.engine.stats()).deep.includes({ repos: 1, workers: 1 })
    h.engine.removeInterest(1, ['repoB'])
    expect(h.engine.stats()).deep.includes({ repos: 0, workers: 0 })
  })

  it('replaces a wedged feed from its last sequence, then gives up', async () => {
    const h = makeHarness({ feedTimeoutMs: 20, maxRestarts: 2 })
    h.engine.start()
    h.feed().since = '42-abc'
    // No poll ever completes:
    await delay(200)
    expect(h.feeds.length).equals(3)
    expect(h.feeds[0].stopped).equals(true)
    expect(h.feeds[1].since).equals('42-abc')
    expect(h.fatal.length).equals(1)
    expect(h.feeds.every(feed => feed.stopped)).equals(true)
  })

  it('keeps a healthy idle feed', async () => {
    const h = makeHarness({ feedTimeoutMs: 20, maxRestarts: 2 })
    h.engine.start()
    const timer = setInterval(() => h.feed().handlers.onPoll(), 10)
    await delay(200)
    clearInterval(timer)
    expect(h.feeds.length).equals(1)
    expect(h.fatal).deep.equals([])
    h.engine.stop()
  })

  it('stops delivering after stop', async () => {
    const h = makeHarness()
    h.engine.start()
    h.engine.addInterest(1, ['repoA'])
    h.emit('repoA:1')
    h.engine.stop()
    await delay(60)
    expect(h.delivered).deep.equals([])
    expect(h.feed().stopped).equals(true)
  })
})
