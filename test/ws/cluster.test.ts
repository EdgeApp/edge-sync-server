import { expect } from 'chai'
import { ChildProcess, spawn } from 'child_process'
import { randomBytes } from 'crypto'
import { unlinkSync, writeFileSync } from 'fs'
import { after, describe, it } from 'mocha'
import nano from 'nano'
import { createServer, Server, Socket } from 'net'
import fetch from 'node-fetch'
import { tmpdir } from 'os'
import { join } from 'path'

import { config } from '../../src/config'
import { syncKeyToRepoId } from '../../src/util/security'
import { connectWs, TestWsClient } from '../util/ws-client'
import { delay, makeEdgeBox } from '../utils'

const freePort = async (): Promise<number> =>
  await new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, () => {
      const address = server.address()
      server.close(() =>
        typeof address === 'object' && address != null
          ? resolve(address.port)
          : reject(new Error('No port'))
      )
    })
  })

interface RunningCluster {
  port: number
  wsUrl: string
  /** Worker PIDs, one per socket, in connection order. */
  connectionPids: number[]
  stop: () => Promise<void>
}

/**
 * Runs the real entry point: a cluster master hosting the change feed and
 * two workers owning the sockets, talking over IPC.
 */
const startCluster = async (
  overrides: object,
  cleanups: Array<() => Promise<void>>
): Promise<RunningCluster> => {
  const databaseName = `sync_store_cluster_${randomBytes(4).toString('hex')}`
  const configPath = join(tmpdir(), `${databaseName}.json`)
  const port = await freePort()
  writeFileSync(
    configPath,
    JSON.stringify({
      ...config,
      httpPort: port,
      instanceCount: 2,
      storeDatabaseName: databaseName,
      couchSharding: { q: 1, n: 1 },
      changeFeedTimeoutMs: 5000,
      changeFeedCoalesceMs: 100,
      ...overrides
    })
  )
  const child: ChildProcess = spawn(
    process.execPath,
    ['-r', 'sucrase/register', 'src/index.ts'],
    {
      env: { ...process.env, NODE_ENV: 'production', CONFIG: configPath },
      stdio: ['ignore', 'pipe', 'inherit']
    }
  )
  const connectionPids: number[] = []
  const started = { workers: 0 }
  let buffered = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    buffered += chunk.toString()
    const lines = buffered.split('\n')
    buffered = lines.pop() ?? ''
    for (const line of lines) {
      try {
        const entry = JSON.parse(line)
        if (entry.msg === 'WebSocket connection opened') {
          connectionPids.push(entry.pid)
        }
        if (entry.msg === `HTTP server started listening on ${port}.`) {
          started.workers += 1
        }
      } catch (error) {}
    }
  })
  const stop = async (): Promise<void> => {
    if (child.exitCode == null && child.signalCode == null) {
      const exited = new Promise(resolve => child.on('exit', resolve))
      child.kill('SIGTERM')
      await Promise.race([exited, delay(8000)])
    }
    try {
      unlinkSync(configPath)
    } catch (error) {}
    await nano(config.couchUri)
      .db.destroy(databaseName)
      .catch(() => {})
  }
  cleanups.push(stop)
  for (let i = 0; i < 200 && started.workers < 2; ++i) await delay(100)
  expect(started.workers).equals(2)
  return {
    port,
    wsUrl: `ws://127.0.0.1:${port}/api/v2/ws`,
    connectionPids,
    stop
  }
}

/** A TCP proxy to CouchDB that a test can cut. */
const startCouchProxy = async (): Promise<{
  uri: string
  cut: () => void
}> => {
  const target = new URL(config.couchUri)
  const sockets = new Set<Socket>()
  const server: Server = createServer(client => {
    const upstream = new Socket()
    upstream.connect(Number(target.port), target.hostname)
    client.pipe(upstream)
    upstream.pipe(client)
    sockets.add(client)
    sockets.add(upstream)
    client.on('error', () => upstream.destroy())
    upstream.on('error', () => client.destroy())
  })
  const port = await freePort()
  await new Promise<void>(resolve => server.listen(port, resolve))
  const uri = new URL(config.couchUri)
  uri.port = String(port)
  return {
    uri: uri.toString().replace(/\/$/, ''),
    cut() {
      server.close()
      for (const socket of sockets) socket.destroy()
    }
  }
}

const putRepo = async (
  port: number
): Promise<{ syncKey: string; repoId: string }> => {
  const syncKey = randomBytes(20).toString('hex')
  const res = await fetch(`http://127.0.0.1:${port}/api/v2/store/${syncKey}`, {
    method: 'PUT'
  })
  expect(res.status).equals(201)
  return { syncKey, repoId: syncKeyToRepoId(syncKey) }
}

describe('Integration: clustered WebSocket subscriptions', function () {
  this.timeout(60000)
  const cleanups: Array<() => Promise<void>> = []
  const clients: TestWsClient[] = []

  after(async () => {
    await Promise.all(clients.map(async client => await client.close()))
    for (const cleanup of cleanups) await cleanup()
  })

  it('notifies sockets on both workers from one write', async () => {
    const cluster = await startCluster({}, cleanups)
    const { syncKey, repoId } = await putRepo(cluster.port)

    // Open sockets until both workers own at least one:
    const mine: TestWsClient[] = []
    for (let i = 0; i < 10 && new Set(cluster.connectionPids).size < 2; ++i) {
      mine.push(await connectWs(cluster.wsUrl))
      await delay(50)
    }
    clients.push(...mine)
    expect(new Set(cluster.connectionPids).size).equals(2)

    for (const client of mine) {
      const reply = await client.call('subscribeRepos', [[repoId, '0:0']])
      expect(reply.result).deep.equals([1])
    }

    const res = await fetch(
      `http://127.0.0.1:${cluster.port}/api/v2/store/${syncKey}/`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ changes: { 'a.json': makeEdgeBox('x') } })
      }
    )
    expect(res.status).equals(200)
    const checkpoint = ((await res.json()) as { hash: string }).hash.split(
      ','
    )[0]

    for (const client of mine) {
      expect(await client.nextNotification(5000)).deep.equals({
        method: 'update',
        params: [[repoId, checkpoint]]
      })
    }
  })

  it('caps sockets per IP across every worker on the host', async () => {
    const cluster = await startCluster({ wsMaxConnectionsPerIp: 3 }, cleanups)
    const mine: TestWsClient[] = []
    for (let i = 0; i < 3; ++i) mine.push(await connectWs(cluster.wsUrl))
    clients.push(...mine)
    await delay(100)
    // The three open sockets span both workers, yet the host allows three:
    expect(new Set(cluster.connectionPids).size).equals(2)

    let refused: unknown
    await connectWs(cluster.wsUrl).catch(error => {
      refused = error
    })
    expect(String(refused)).contains('429')

    // Closing one frees a slot for the next socket:
    await mine[0].close()
    await delay(100)
    clients.push(await connectWs(cluster.wsUrl))
  })

  it('sends subLost before the master gives up on a dead feed', async () => {
    const proxy = await startCouchProxy()
    const cluster = await startCluster(
      {
        couchUri: proxy.uri,
        changeFeedTimeoutMs: 500,
        changeFeedMaxRestarts: 2
      },
      cleanups
    )
    const { repoId } = await putRepo(cluster.port)
    const client = await connectWs(cluster.wsUrl)
    clients.push(client)
    const reply = await client.call('subscribeRepos', [[repoId]])
    expect(reply.result).deep.equals([1])

    const closed = new Promise<number>(resolve =>
      client.ws.on('close', code => resolve(code))
    )
    proxy.cut()
    expect(await client.nextNotification(15000)).deep.equals({
      method: 'subLost',
      params: [[repoId]]
    })
    expect(await closed).equals(1012)
  })
})
