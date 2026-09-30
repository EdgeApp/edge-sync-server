import { execSync } from 'child_process'
import { asNumber, asObject, asOptional, asString } from 'cleaners'
import { randomBytes } from 'crypto'
import fetch from 'node-fetch'
import WebSocket from 'ws'

import { syncKeyToRepoId } from '../../util/security'

/**
 * WebSocket subscription load test. Opens many sockets, each subscribed to
 * many repos, writes to a few real repos at a steady rate, and reports how
 * long each write takes to reach every subscribed socket.
 *
 * Usage: node -r sucrase/register src/bin/ws-load-test/index.ts '<json>'
 * where every field of the JSON is optional (see `asConfig`).
 *
 * The server's `wsMaxConnectionsPerIp` must allow `sockets` connections from
 * the load test's address.
 */
const asConfig = asObject({
  server: asOptional(asString, 'http://127.0.0.1:8010'),
  couchUri: asOptional(asString, 'http://admin:admin@127.0.0.1:5984'),
  sockets: asOptional(asNumber, 1000),
  reposPerSocket: asOptional(asNumber, 50),
  /** Repos that really exist and receive writes. */
  liveRepos: asOptional(asNumber, 100),
  /** Live repos each socket subscribes to; the rest are absent repos. */
  liveReposPerSocket: asOptional(asNumber, 2),
  writesPerSecond: asOptional(asNumber, 10),
  durationSeconds: asOptional(asNumber, 60)
})

interface LiveRepo {
  syncKey: string
  repoId: string
  hash: string
  sockets: number
  /** Write start times waiting for notifications, oldest first. */
  inFlight: Array<{ at: number; remaining: number }>
}

const config = asConfig(JSON.parse(process.argv[2] ?? '{}'))
const wsUrl = `${config.server.replace(/^http/, 'ws')}/api/v2/ws`
const latencies: number[] = []
let notifications = 0
let socketErrors = 0
let lostSockets = 0

const percentile = (sorted: number[], p: number): number =>
  sorted.length === 0
    ? NaN
    : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]

const box = (): object => ({
  iv_hex: '',
  encryptionType: 0,
  data_base64: randomBytes(16).toString('base64')
})

const couchRequests = async (): Promise<number> => {
  const res = await fetch(
    `${config.couchUri}/_node/_local/_stats/couchdb/httpd/requests`
  )
  const body = (await res.json()) as { value: number }
  return body.value
}

const serverRss = (): string => {
  try {
    const port = new URL(config.server).port
    // Under the cluster's round-robin scheduling the master holds the
    // listening socket and the workers are its children.
    const master: string = execSync(`lsof -t -iTCP:${port} -sTCP:LISTEN`)
      .toString()
      .trim()
      .split('\n')[0]
    const all: string[] = execSync(`pgrep -P ${master}`)
      .toString()
      .trim()
      .split('\n')
    const rss: number[] = execSync(
      `ps -o rss= -p ${[master, ...all].join(',')}`
    )
      .toString()
      .trim()
      .split('\n')
      .map((line: string) => parseInt(line.trim()))
    return `${Math.round(
      rss.reduce((a: number, b: number) => a + b, 0) / 1024
    )} MB total (master + ${all.length} workers)`
  } catch (error) {
    return `unavailable (${String(error)})`
  }
}

async function main(): Promise<void> {
  console.log('config', config)

  // Create the live repos:
  const live: LiveRepo[] = []
  for (let i = 0; i < config.liveRepos; ++i) {
    const syncKey = randomBytes(20).toString('hex')
    const res = await fetch(`${config.server}/api/v2/store/${syncKey}`, {
      method: 'PUT'
    })
    if (res.status !== 201 && res.status !== 200)
      throw new Error(`PUT failed: ${res.status}`)
    live.push({
      syncKey,
      repoId: syncKeyToRepoId(syncKey),
      hash: '',
      sockets: 0,
      inFlight: []
    })
  }
  const byRepoId = new Map(live.map(repo => [repo.repoId, repo]))

  // Open and subscribe the sockets:
  const openStart = Date.now()
  const sockets: WebSocket[] = []
  const subscribeResults = { '-1': 0, '0': 0, '1': 0, '2': 0 }
  let replies = 0
  const couchBeforeSubscribe = await couchRequests()
  console.log('server RSS before subscribe:', serverRss())
  for (let i = 0; i < config.sockets; ++i) {
    const ws = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => {
      ws.once('open', resolve)
      ws.once('error', reject)
    })
    ws.on('error', () => (socketErrors += 1))
    ws.on('close', () => (lostSockets += 1))
    ws.on('message', data => {
      const message = JSON.parse((data as Buffer).toString())
      if (message.id != null) {
        replies += 1
        for (const r of message.result ?? []) {
          subscribeResults[String(r) as '1'] += 1
        }
        return
      }
      if (message.method !== 'update') return
      const now = Date.now()
      for (const [repoId] of message.params) {
        const repo = byRepoId.get(repoId)
        const pending = repo?.inFlight[0]
        if (repo == null || pending == null) continue
        notifications += 1
        latencies.push(now - pending.at)
        if (--pending.remaining === 0) repo.inFlight.shift()
      }
    })

    const params: Array<[string]> = []
    for (let j = 0; j < config.liveReposPerSocket; ++j) {
      const repo = live[(i * config.liveReposPerSocket + j) % live.length]
      repo.sockets += 1
      params.push([repo.repoId])
    }
    while (params.length < config.reposPerSocket) {
      params.push([syncKeyToRepoId(randomBytes(20).toString('hex'))])
    }
    ws.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id: i,
        method: 'subscribeRepos',
        params
      })
    )
    sockets.push(ws)
  }
  // Let every subscribe answer before measuring writes:
  const openedAt = Date.now()
  while (replies < sockets.length && Date.now() - openedAt < 120000) {
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  console.log(
    `opened ${sockets.length} sockets in ${openedAt - openStart} ms;`,
    `all ${replies} subscribe calls answered after ${
      Date.now() - openStart
    } ms;`,
    `${(await couchRequests()) - couchBeforeSubscribe} CouchDB requests;`,
    'subscribe results',
    subscribeResults
  )
  console.log('server RSS after subscribe:', serverRss())

  // Write at a steady rate:
  const couchBefore = await couchRequests()
  const endAt = Date.now() + config.durationSeconds * 1000
  let writes = 0
  let expected = 0
  while (Date.now() < endAt) {
    const repo = live[writes % live.length]
    writes += 1
    // One notification per write is only guaranteed when writes to a repo
    // are further apart than the coalescing window, which this pacing keeps.
    const entry = { at: Date.now(), remaining: repo.sockets }
    expected += repo.sockets
    repo.inFlight.push(entry)
    const res = await fetch(
      `${config.server}/api/v2/store/${repo.syncKey}/${repo.hash}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ changes: { 'file.json': box() } })
      }
    )
    const body = (await res.json()) as { hash: string }
    repo.hash = body.hash
    await new Promise(resolve =>
      setTimeout(resolve, 1000 / config.writesPerSecond)
    )
  }
  await new Promise(resolve => setTimeout(resolve, 3000))
  const couchAfter = await couchRequests()

  const sorted = [...latencies].sort((a, b) => a - b)
  console.log(
    JSON.stringify(
      {
        sockets: sockets.length,
        subscriptions: sockets.length * config.reposPerSocket,
        writes,
        expectedNotifications: expected,
        notifications,
        latencyMs: {
          p50: percentile(sorted, 0.5),
          p99: percentile(sorted, 0.99),
          max: sorted[sorted.length - 1]
        },
        couchRequestsDuringWrites: couchAfter - couchBefore,
        couchRequestsPerWrite: (couchAfter - couchBefore) / writes,
        socketErrors,
        lostSockets,
        serverRss: serverRss()
      },
      null,
      2
    )
  )
  for (const ws of sockets) ws.terminate()
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
