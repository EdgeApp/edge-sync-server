import { expect } from 'chai'
import { EventEmitter } from 'events'
import { describe, it } from 'mocha'

import {
  HubLink,
  makeChangeHub,
  makeIpcHubLink,
  RepoSubscriber
} from '../../src/engine/changeHub'
import { RepoUpdate } from '../../src/engine/repoChangeEngine'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const makeFakeLink = () => {
  const added: string[][] = []
  const removed: string[][] = []
  let push: (updates: RepoUpdate[]) => void = () => {}
  let fail = false
  const link: HubLink = {
    async addInterest(repoIds) {
      added.push(repoIds)
      if (fail) throw new Error('no ack')
    },
    removeInterest(repoIds) {
      removed.push(repoIds)
    },
    onUpdates(cb) {
      push = cb
    }
  }
  return {
    link,
    added,
    removed,
    push: (updates: RepoUpdate[]) => push(updates),
    setFail(value: boolean) {
      fail = value
    }
  }
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const makeSubscriber = () => {
  const seen: Array<Array<[string, unknown]>> = []
  const subscriber: RepoSubscriber = {
    handleUpdates(updates) {
      seen.push(updates)
    }
  }
  return { subscriber, seen }
}

describe('Unit: changeHub', () => {
  it('registers each repo with the engine once across sockets', async () => {
    const fake = makeFakeLink()
    const hub = makeChangeHub(fake.link)
    const a = makeSubscriber()
    const b = makeSubscriber()

    await hub.watch(a.subscriber, ['r1', 'r2'])
    await hub.watch(b.subscriber, ['r2', 'r3'])
    expect(fake.added).deep.equals([['r1', 'r2'], ['r3']])

    hub.unwatch(a.subscriber, ['r1', 'r2'])
    expect(fake.removed).deep.equals([['r1']])
    hub.unwatch(b.subscriber, ['r2', 'r3', 'unknown'])
    expect(fake.removed).deep.equals([['r1'], ['r2', 'r3']])
    expect(hub.stats().repos).equals(0)
  })

  it('routes updates only to the subscribers of each repo', async () => {
    const fake = makeFakeLink()
    const hub = makeChangeHub(fake.link)
    const a = makeSubscriber()
    const b = makeSubscriber()
    await hub.watch(a.subscriber, ['r1'])
    await hub.watch(b.subscriber, ['r1', 'r2'])

    fake.push([
      ['r1', '1:1'],
      ['r2', '2:3'],
      ['r9', '1:1']
    ])
    expect(a.seen).deep.equals([[['r1', { version: 1, sum: 1 }]]])
    expect(b.seen).deep.equals([
      [
        ['r1', { version: 1, sum: 1 }],
        ['r2', { version: 2, sum: 3 }]
      ]
    ])
    expect(hub.subscribers().length).equals(2)
  })

  it('forgets repos the engine never acknowledged', async () => {
    const fake = makeFakeLink()
    const hub = makeChangeHub(fake.link)
    const a = makeSubscriber()
    fake.setFail(true)
    let failed = false
    await hub.watch(a.subscriber, ['r1']).catch(() => {
      failed = true
    })
    expect(failed).equals(true)
    expect(hub.stats().repos).equals(0)

    // The next watcher asks the engine again:
    fake.setFail(false)
    await hub.watch(a.subscriber, ['r1'])
    expect(fake.added).deep.equals([['r1'], ['r1']])
  })
})

describe('Unit: makeIpcHubLink', () => {
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const makeProc = () => {
    const proc = new EventEmitter() as EventEmitter & {
      send: (m: any) => void
      sent: any[]
    }
    proc.sent = []
    proc.send = m => proc.sent.push(m)
    return proc
  }

  it('resolves addInterest on the matching ack', async () => {
    const proc = makeProc()
    const link = makeIpcHubLink(proc, 1000)
    const done = link.addInterest(['r1'])
    expect(proc.sent).deep.equals([{ wsHub: 'watch', id: 1, repoIds: ['r1'] }])
    proc.emit('message', { wsHub: 'ack', id: 1 })
    await done
  })

  it('rejects addInterest when no ack arrives', async () => {
    const link = makeIpcHubLink(makeProc(), 20)
    let error: unknown
    await link.addInterest(['r1']).catch(e => {
      error = e
    })
    expect(String(error)).contains('did not acknowledge')
  })

  it('rejects addInterest without an IPC channel', async () => {
    const proc = new EventEmitter()
    const link = makeIpcHubLink(proc, 20)
    let error: unknown
    await link.addInterest(['r1']).catch(e => {
      error = e
    })
    expect(String(error)).contains('No IPC channel')
    link.removeInterest(['r1']) // Does not throw
  })

  it('passes updates through and ignores foreign messages', () => {
    const proc = makeProc()
    const link = makeIpcHubLink(proc, 1000)
    const got: RepoUpdate[][] = []
    link.onUpdates(updates => got.push(updates))
    proc.emit('message', { something: 'else' })
    proc.emit('message', { wsHub: 'updates', updates: [['r1', '1:1']] })
    link.removeInterest(['r1'])
    expect(got).deep.equals([[['r1', '1:1']]])
    expect(proc.sent).deep.equals([{ wsHub: 'unwatch', repoIds: ['r1'] }])
  })
})
