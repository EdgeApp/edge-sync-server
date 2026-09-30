import { expect } from 'chai'
import { EventEmitter } from 'events'
import { describe, it } from 'mocha'

import {
  makeConnectionCounter,
  makeIpcConnectionLimiter,
  makeLocalConnectionLimiter
} from '../../src/engine/connectionLimiter'

describe('Unit: connection counter', () => {
  it('caps each IP across workers and frees a dead worker’s slots', () => {
    const counter = makeConnectionCounter(3)
    expect(counter.reserve(1, 'a')).equals(true)
    expect(counter.reserve(2, 'a')).equals(true)
    expect(counter.reserve(2, 'a')).equals(true)
    expect(counter.reserve(1, 'a')).equals(false)
    expect(counter.reserve(1, 'b')).equals(true)

    counter.release(1, 'a')
    expect(counter.count('a')).equals(2)
    // A release the worker does not hold changes nothing:
    counter.release(1, 'a')
    counter.release(3, 'a')
    expect(counter.count('a')).equals(2)

    counter.removeWorker(2)
    expect(counter.count('a')).equals(0)
    expect(counter.count('b')).equals(1)
  })

  it('backs a local limiter', async () => {
    const limiter = makeLocalConnectionLimiter(makeConnectionCounter(1))
    expect(await limiter.reserve('a')).equals(true)
    expect(await limiter.reserve('a')).equals(false)
    limiter.release('a')
    expect(await limiter.reserve('a')).equals(true)
  })
})

describe('Unit: makeIpcConnectionLimiter', () => {
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

  it('asks the master and uses its answer', async () => {
    const proc = makeProc()
    const limiter = makeIpcConnectionLimiter(proc, 1000)
    const first = limiter.reserve('a')
    const second = limiter.reserve('a')
    proc.emit('message', { wsConn: 'reserved', id: 2, ok: false })
    proc.emit('message', { wsConn: 'reserved', id: 1, ok: true })
    proc.emit('message', { unrelated: true })
    expect(await first).equals(true)
    expect(await second).equals(false)
    limiter.release('a')
    expect(proc.sent).deep.equals([
      { wsConn: 'reserve', id: 1, ip: 'a' },
      { wsConn: 'reserve', id: 2, ip: 'a' },
      { wsConn: 'release', ip: 'a' }
    ])
  })

  it('refuses when the master does not answer or is gone', async () => {
    expect(await makeIpcConnectionLimiter(makeProc(), 20).reserve('a')).equals(
      false
    )
    const noChannel = makeIpcConnectionLimiter(new EventEmitter(), 20)
    expect(await noChannel.reserve('a')).equals(false)
    noChannel.release('a') // Does not throw
  })
})
