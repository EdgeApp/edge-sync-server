import bs58 from 'bs58'
import { expect } from 'chai'
import { randomBytes } from 'crypto'
import { describe, it } from 'mocha'

import { ChangeHub, RepoSubscriber } from '../../src/engine/changeHub'
import { makeSubscriptionRegistry } from '../../src/engine/subscriptionRegistry'
import { Checkpoint } from '../../src/types/checkpoints'

const repoId = (): string => bs58.encode(randomBytes(32))

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const makeHarness = (
  options: {
    getCheckpoint?: (repoId: string) => Promise<Checkpoint>
    watchFails?: boolean
    max?: number
  } = {}
) => {
  const watched = new Set<string>()
  const updates: Array<Array<[string, string]>> = []
  const lost: Array<Array<[string]>> = []
  const server = new Map<string, Checkpoint>()
  let onWatch: (() => void) | undefined
  const hub: ChangeHub = {
    async watch(_sub: RepoSubscriber, repoIds: string[]) {
      if (options.watchFails === true) throw new Error('no ack')
      for (const id of repoIds) watched.add(id)
      onWatch?.()
    },
    unwatch(_sub: RepoSubscriber, repoIds: string[]) {
      for (const id of repoIds) watched.delete(id)
    },
    subscribers: () => [],
    stats: () => ({ repos: watched.size })
  }
  const registry = makeSubscriptionRegistry({
    hub,
    getCheckpoint:
      options.getCheckpoint ??
      (async id => server.get(id) ?? { version: 0, sum: 0 }),
    sendUpdate: u => updates.push(u),
    sendSubLost: l => lost.push(l),
    maxSubscriptions: options.max ?? 200
  })
  return {
    registry,
    watched,
    updates,
    lost,
    server,
    setOnWatch(cb: () => void) {
      onWatch = cb
    }
  }
}

describe('Unit: subscriptionRegistry', () => {
  it('answers 1 for a matching checkpoint and 2 for a stale one', async () => {
    const h = makeHarness()
    const [a, b, c] = [repoId(), repoId(), repoId()]
    h.server.set(a, { version: 3, sum: 6 })
    h.server.set(b, { version: 3, sum: 6 })
    const results = await h.registry.subscribe([
      [a, '3:6'],
      [b, '2:3'],
      [c] // Absent repo, no checkpoint: 0:0 == 0:0
    ])
    expect(results).deep.equals([1, 2, 1])
    expect(h.watched.size).equals(3)
  })

  it('answers 2 when the client has nothing and the server has data', async () => {
    const h = makeHarness()
    const a = repoId()
    h.server.set(a, { version: 1, sum: 1 })
    expect(await h.registry.subscribe([[a]])).deep.equals([2])
  })

  it('answers -1 for malformed entries without registering them', async () => {
    const h = makeHarness()
    const results = await h.registry.subscribe([
      ['junk'],
      [repoId(), 'not-a-checkpoint'],
      [42],
      ['1'.repeat(45)]
    ])
    expect(results).deep.equals([-1, -1, -1, -1])
    expect(h.registry.size()).equals(0)
    expect(h.watched.size).equals(0)
  })

  it('answers 0, never 1, when the checkpoint cannot be read', async () => {
    const h = makeHarness({
      async getCheckpoint() {
        throw new Error('couch down')
      }
    })
    const a = repoId()
    expect(await h.registry.subscribe([[a, '0:0']])).deep.equals([0])
    expect(h.registry.size()).equals(0)
    expect(h.watched.size).equals(0)
  })

  it('answers 0 when the engine does not acknowledge', async () => {
    const h = makeHarness({ watchFails: true })
    expect(await h.registry.subscribe([[repoId()]])).deep.equals([0])
    expect(h.registry.size()).equals(0)
  })

  it('answers 0 past the subscription cap and keeps the rest', async () => {
    const h = makeHarness({ max: 2 })
    const ids = [repoId(), repoId(), repoId()]
    expect(await h.registry.subscribe(ids.map(id => [id]))).deep.equals([
      1,
      1,
      0
    ])
    // Re-subscribing a held repo is not a new subscription:
    expect(await h.registry.subscribe([[ids[0]]])).deep.equals([1])
    expect(h.registry.size()).equals(2)
  })

  it('notifies only for checkpoints the client has not been told', async () => {
    const h = makeHarness()
    const [a, b] = [repoId(), repoId()]
    h.server.set(a, { version: 1, sum: 1 })
    await h.registry.subscribe([[a, '1:1'], [b]])
    h.registry.flushQueued()

    h.registry.handleUpdates([
      [a, { version: 1, sum: 1 }], // Already known
      [b, { version: 2, sum: 3 }]
    ])
    h.registry.handleUpdates([[b, { version: 2, sum: 3 }]]) // Repeat
    h.registry.handleUpdates([
      [a, { version: 2, sum: 3 }],
      [b, { version: 3, sum: 6 }]
    ])
    expect(h.updates).deep.equals([
      [[b, '2:3']],
      [
        [a, '2:3'],
        [b, '3:6']
      ]
    ])
  })

  it('holds updates that race a subscribe until its answer is out', async () => {
    const h = makeHarness()
    const a = repoId()
    h.setOnWatch(() => h.registry.handleUpdates([[a, { version: 4, sum: 10 }]]))
    const results = await h.registry.subscribe([[a, '0:0']])
    expect(results).deep.equals([1])
    expect(h.updates).deep.equals([])
    h.registry.flushQueued()
    expect(h.updates).deep.equals([[[a, '4:10']]])
  })

  it('unsubscribes, and ignores repos it does not hold', async () => {
    const h = makeHarness()
    const [a, b] = [repoId(), repoId()]
    await h.registry.subscribe([[a], [b]])
    h.registry.flushQueued()
    h.registry.unsubscribe([a, repoId(), 'junk'])
    expect(h.registry.size()).equals(1)
    expect([...h.watched]).deep.equals([b])
    h.registry.handleUpdates([[a, { version: 9, sum: 9 }]])
    expect(h.updates).deep.equals([])
  })

  it('sends subLost for everything, then closes', async () => {
    const h = makeHarness()
    const [a, b] = [repoId(), repoId()]
    await h.registry.subscribe([[a], [b]])
    h.registry.loseAll()
    expect(h.lost).deep.equals([[[a], [b]]])
    expect(h.watched.size).equals(0)
    h.registry.handleUpdates([[a, { version: 9, sum: 9 }]])
    expect(h.updates).deep.equals([])
  })

  it('answers 0 for everything when closed mid-subscribe', async () => {
    const h = makeHarness()
    h.setOnWatch(() => h.registry.close())
    expect(await h.registry.subscribe([[repoId()]])).deep.equals([0])
    expect(h.watched.size).equals(0)
  })
})
