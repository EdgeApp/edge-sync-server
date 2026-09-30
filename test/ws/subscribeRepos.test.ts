import { expect } from 'chai'
import { randomBytes } from 'crypto'
import { after, afterEach, before, describe, it } from 'mocha'
import WebSocket from 'ws'

import { syncKeyToRepoId } from '../../src/util/security'
import {
  AppTestKit,
  ListeningKit,
  ListenOptions,
  makeAppTestKit
} from '../util/app-test-kit'
import { connectWs, TestWsClient } from '../util/ws-client'
import { delay, isSuccessfulResponse, makeEdgeBox } from '../utils'

interface Repo {
  syncKey: string
  repoId: string
  /** The newest checkpoint the server returned for this repo. */
  checkpoint: string
}

const makeRepo = async (kit: AppTestKit): Promise<Repo> => {
  const syncKey = randomBytes(20).toString('hex')
  await kit.agent
    .put(`/api/v2/store/${syncKey}`)
    .expect(res => isSuccessfulResponse(res))
  return { syncKey, repoId: syncKeyToRepoId(syncKey), checkpoint: '0:0' }
}

const writeRepo = async (kit: AppTestKit, repo: Repo): Promise<string> => {
  const res = await kit.agent
    .post(`/api/v2/store/${repo.syncKey}/${repo.checkpoint}`)
    .send({
      changes: {
        [`file${randomBytes(4).toString('hex')}.json`]: makeEdgeBox('x')
      }
    })
    .expect(res => isSuccessfulResponse(res))
  repo.checkpoint = res.body.hash.split(',')[0]
  return repo.checkpoint
}

/** Waits long enough for any notification the coalescing window would send. */
const settle = async (): Promise<void> => await delay(600)

describe('Component: WebSocket repo subscriptions', () => {
  const kit = makeAppTestKit()
  let listening: ListeningKit
  let wsUrl = ''
  let clients: TestWsClient[] = []

  const listen = async (options?: ListenOptions): Promise<void> => {
    await kit.closeServer()
    listening = await kit.listen(options)
    wsUrl = listening.wsUrl
  }
  const connect = async (): Promise<TestWsClient> => {
    const client = await connectWs(wsUrl)
    clients.push(client)
    return client
  }

  before(kit.setup)
  before(async () => await listen())
  afterEach(async () => {
    await Promise.all(clients.map(async client => await client.close()))
    clients = []
  })
  after(async () => {
    await kit.closeServer()
    await kit.cleanup()
  })

  it('answers ping', async () => {
    const client = await connect()
    expect((await client.call('ping', [])).result).equals('pong')
  })

  it('answers each entry by comparing checkpoints', async () => {
    const written = await makeRepo(kit)
    await writeRepo(kit, written)
    const stale = written.checkpoint
    await writeRepo(kit, written)
    const empty = await makeRepo(kit)

    const client = await connect()
    const reply = await client.call('subscribeRepos', [
      [written.repoId, stale], // Behind the server: pull
      [written.repoId, written.checkpoint], // Current: nothing to pull
      [empty.repoId], // Nothing on either side
      [syncKeyToRepoId(randomBytes(20).toString('hex'))], // Absent repo
      ['not a repo id'],
      [written.repoId, 'bad checkpoint']
    ])
    expect(reply.result).deep.equals([2, 1, 1, 1, -1, -1])

    const fresh = await connect()
    const reply2 = await fresh.call('subscribeRepos', [[written.repoId]])
    expect(reply2.result).deep.equals([2])
  })

  it('sends exactly one update carrying the new checkpoint', async () => {
    const repo = await makeRepo(kit)
    await writeRepo(kit, repo)
    const client = await connect()
    const reply = await client.call('subscribeRepos', [
      [repo.repoId, repo.checkpoint]
    ])
    expect(reply.result).deep.equals([1])

    const checkpoint = await writeRepo(kit, repo)
    const update = await client.nextNotification()
    expect(update).deep.equals({
      method: 'update',
      params: [[repo.repoId, checkpoint]]
    })
    await settle()
    expect(client.notifications.length).equals(1)
  })

  it('reports several changed repos in one update', async () => {
    const repos = [
      await makeRepo(kit),
      await makeRepo(kit),
      await makeRepo(kit)
    ]
    const client = await connect()
    await client.call(
      'subscribeRepos',
      repos.map(repo => [repo.repoId])
    )
    await Promise.all([writeRepo(kit, repos[0]), writeRepo(kit, repos[2])])
    const update = await client.nextNotification()
    expect(update.method).equals('update')
    expect(update.params).to.have.deep.members([
      [repos[0].repoId, repos[0].checkpoint],
      [repos[2].repoId, repos[2].checkpoint]
    ])
    await settle()
    expect(client.notifications.length).equals(1)
  })

  it('notifies every socket subscribed to the same repo', async () => {
    const repo = await makeRepo(kit)
    const a = await connect()
    const b = await connect()
    await a.call('subscribeRepos', [[repo.repoId]])
    await b.call('subscribeRepos', [[repo.repoId]])
    const checkpoint = await writeRepo(kit, repo)
    const expected = { method: 'update', params: [[repo.repoId, checkpoint]] }
    expect(await a.nextNotification()).deep.equals(expected)
    expect(await b.nextNotification()).deep.equals(expected)
  })

  it('sends nothing after unsubscribeRepos', async () => {
    const repo = await makeRepo(kit)
    const client = await connect()
    await client.call('subscribeRepos', [[repo.repoId]])
    const reply = await client.call('unsubscribeRepos', [[repo.repoId]])
    expect(reply).not.have.property('error')
    expect(reply).not.have.property('result')
    await writeRepo(kit, repo)
    await settle()
    expect(client.notifications).deep.equals([])
  })

  it('releases every subscription when the socket closes', async () => {
    const repos = [await makeRepo(kit), await makeRepo(kit)]
    const client = await connect()
    await client.call(
      'subscribeRepos',
      repos.map(repo => [repo.repoId])
    )
    expect(listening.hub.stats().repos).equals(2)
    expect(listening.engine.stats().repos).equals(2)
    await client.close()
    await delay(50)
    expect(listening.hub.stats().repos).equals(0)
    expect(listening.engine.stats().repos).equals(0)
  })

  it('rejects more than 100 entries in one call and keeps the socket', async () => {
    const client = await connect()
    const params = []
    for (let i = 0; i < 101; ++i) {
      params.push([syncKeyToRepoId(randomBytes(20).toString('hex'))])
    }
    const reply = await client.call('subscribeRepos', params)
    expect(reply.error.code).equals(-32602)
    expect((await client.call('ping', [])).result).equals('pong')
  })

  it('answers 0 past 200 subscriptions and keeps the first 200', async () => {
    const client = await connect()
    const ids: string[] = []
    for (let i = 0; i < 201; ++i) {
      ids.push(syncKeyToRepoId(randomBytes(20).toString('hex')))
    }
    const first = await client.call(
      'subscribeRepos',
      ids.slice(0, 100).map(id => [id])
    )
    const second = await client.call(
      'subscribeRepos',
      ids.slice(100, 200).map(id => [id])
    )
    const third = await client.call('subscribeRepos', [[ids[200]]])
    expect(first.result.every((r: number) => r === 1)).equals(true)
    expect(second.result.every((r: number) => r === 1)).equals(true)
    expect(third.result).deep.equals([0])
  })

  it('rejects malformed params and garbage frames, and keeps the socket', async () => {
    const client = await connect()
    expect((await client.call('subscribeRepos', 'nope')).error.code).equals(
      -32600
    )
    client.sendRaw('{"jsonrpc":"2.0","method":"ping"}')
    expect(
      (await client.call('subscribeRepos', [['a', 'b', 'c']])).error.code
    ).equals(-32602)
    expect((await client.call('unsubscribeRepos', [{}])).error.code).equals(
      -32602
    )
    client.sendRaw('this is not json')
    await delay(50)
    expect(client.orphans).deep.equals([
      {
        id: null,
        error: { code: -32600, message: 'Invalid Request' },
        jsonrpc: '2.0'
      },
      {
        id: null,
        error: { code: -32700, message: 'Parse error' },
        jsonrpc: '2.0'
      }
    ])
    expect((await client.call('nope', [])).error.message).equals(
      'Method not found'
    )
    expect((await client.call('ping', [])).result).equals('pong')
  })

  it('answers 0, never 1, when the checkpoint read fails', async () => {
    await listen({
      getCheckpoint: async () => {
        throw new Error('CouchDB is down')
      }
    })
    try {
      const repo = await makeRepo(kit)
      const client = await connect()
      const reply = await client.call('subscribeRepos', [[repo.repoId, '0:0']])
      expect(reply.result).deep.equals([0])
      expect(listening.hub.stats().repos).equals(0)
    } finally {
      await listen()
    }
  })

  it('limits subscribe calls per minute', async () => {
    await listen({ config: { wsSubscribeCallsPerMinute: 2 } })
    try {
      const client = await connect()
      await client.call('subscribeRepos', [])
      await client.call('subscribeRepos', [])
      const reply = await client.call('subscribeRepos', [])
      expect(reply.error.code).equals(-32000)
      expect((await client.call('ping', [])).result).equals('pong')
    } finally {
      await listen()
    }
  })

  it('caps connections per IP', async () => {
    await listen({ config: { wsMaxConnectionsPerIp: 2 } })
    try {
      await connect()
      await connect()
      let error: unknown
      await connectWs(wsUrl).catch(e => {
        error = e
      })
      expect(String(error)).contains('429')
    } finally {
      await listen()
    }
  })

  it('only upgrades on the WebSocket path', async () => {
    let error: unknown
    await connectWs(wsUrl.replace('/api/v2/ws', '/api/v2/other')).catch(e => {
      error = e
    })
    expect(error).not.equals(undefined)
  })

  it('drops a socket that stops answering pings', async () => {
    await listen({ config: { wsPingIntervalMs: 50 } })
    try {
      // ws supports autoPong; its bundled types predate the option.
      const noPong: WebSocket.ClientOptions = { autoPong: false } as any
      const silent = new WebSocket(wsUrl, noPong)
      const closedAt = new Promise<number>(resolve =>
        silent.on('close', () => resolve(Date.now()))
      )
      await new Promise(resolve => silent.on('open', resolve))
      const openedAt = Date.now()
      // A healthy client stays connected over the same period:
      const healthy = await connect()
      const closed = await Promise.race([closedAt, delay(2000).then(() => 0)])
      expect(closed).not.equals(0)
      expect(closed - openedAt).lessThan(1000)
      expect(healthy.ws.readyState).equals(WebSocket.OPEN)
    } finally {
      await listen()
    }
  })
})
