import { expect } from 'chai'
import { IncomingMessage } from 'http'
import { describe, it } from 'mocha'

import { clientIp } from '../../src/ws-server'

describe('Unit: clientIp', () => {
  const request = (
    remoteAddress: string,
    forwarded?: string
  ): IncomingMessage =>
    (({
      socket: { remoteAddress },
      headers: forwarded == null ? {} : { 'x-forwarded-for': forwarded }
    } as unknown) as IncomingMessage)

  it('uses the address the proxy appended when behind loopback', () => {
    expect(clientIp(request('127.0.0.1', 'spoofed, 203.0.113.9'))).equals(
      '203.0.113.9'
    )
    expect(clientIp(request('::ffff:127.0.0.1', '198.51.100.1'))).equals(
      '198.51.100.1'
    )
  })

  it('ignores X-Forwarded-For from anyone but loopback', () => {
    expect(clientIp(request('203.0.113.9', '10.0.0.1'))).equals('203.0.113.9')
    expect(clientIp(request('::1'))).equals('::1')
  })
})
