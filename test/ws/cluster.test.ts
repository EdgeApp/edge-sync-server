import { expect } from 'chai'
import { ChildProcess, spawn } from 'child_process'
import { randomBytes } from 'crypto'
import { unlinkSync, writeFileSync } from 'fs'
import { after, before, describe, it } from 'mocha'
import nano from 'nano'
import { createServer } from 'net'
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

/**
 * Runs the real entry point: a cluster master hosting the change feed and two
 * workers owning the sockets, talking over IPC.
 */
describe('Integration: clustered WebSocket subscriptions', function () {
  this.timeout(60000)

  const databaseName = `sync_store_cluster_${randomBytes(4).toString('hex')}`
  const configPath = join(tmpdir(), `${databaseName}.json`)
  let port = 0
  let child: ChildProcess | undefined
  const connectionPids: number[] = []
  const clients: TestWsClient[] = []

  before(async () => {
    port = await freePort()
    writeFileSync(
      configPath,
      JSON.stringify({
        ...config,
        httpPort: port,
        instanceCount: 2,
        storeDatabaseName: databaseName,
        couchSharding: { q: 1, n: 1 },
        changeFeedTimeoutMs: 5000,
        changeFeedCoalesceMs: 100
      })
    )
    child = spawn(
      process.execPath,
      ['-r', 'sucrase/register', 'src/index.ts'],
      {
        env: { ...process.env, NODE_ENV: 'production', CONFIG: configPath },
        stdio: ['ignore', 'pipe', 'inherit']
      }
    )
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
    for (let i = 0; i < 200 && started.workers < 2; ++i) await delay(100)
    expect(started.workers).equals(2)
  })

  after(async () => {
    await Promise.all(clients.map(async client => await client.close()))
    if (child != null) {
      const exited = new Promise(resolve => child?.on('exit', resolve))
      child.kill('SIGTERM')
      await Promise.race([exited, delay(8000)])
    }
    try {
      unlinkSync(configPath)
    } catch (error) {}
    await nano(config.couchUri)
      .db.destroy(databaseName)
      .catch(() => {})
  })

  it('notifies sockets on both workers from one write', async () => {
    const syncKey = randomBytes(20).toString('hex')
    const repoId = syncKeyToRepoId(syncKey)
    const base = `http://127.0.0.1:${port}/api/v2/store/${syncKey}`
    expect((await fetch(base, { method: 'PUT' })).status).equals(201)

    // Open sockets until both workers own at least one:
    for (let i = 0; i < 10 && new Set(connectionPids).size < 2; ++i) {
      clients.push(await connectWs(`ws://127.0.0.1:${port}/api/v2/ws`))
      await delay(50)
    }
    expect(new Set(connectionPids).size).equals(2)

    for (const client of clients) {
      const reply = await client.call('subscribeRepos', [[repoId, '0:0']])
      expect(reply.result).deep.equals([1])
    }

    const res = await fetch(`${base}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ changes: { 'a.json': makeEdgeBox('x') } })
    })
    expect(res.status).equals(200)
    const checkpoint = ((await res.json()) as { hash: string }).hash.split(
      ','
    )[0]

    for (const client of clients) {
      expect(await client.nextNotification(5000)).deep.equals({
        method: 'update',
        params: [[repoId, checkpoint]]
      })
    }
  })
})
