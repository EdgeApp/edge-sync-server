import { expect } from 'chai'
import { describe, it } from 'mocha'

import { limitConcurrency } from '../../src/util/limit-concurrency'
import { delay } from '../utils'

describe('Unit: limitConcurrency', () => {
  it('runs at most `limit` calls at once, in order, and survives failures', async () => {
    let active = 0
    let peak = 0
    const order: number[] = []
    const limited = limitConcurrency(2, async (n: number) => {
      active += 1
      peak = Math.max(peak, active)
      await delay(10)
      active -= 1
      order.push(n)
      if (n === 1) throw new Error('fails')
      return n * 10
    })
    const results = await Promise.allSettled([1, 2, 3, 4, 5].map(limited))
    expect(peak).equals(2)
    expect(order).deep.equals([1, 2, 3, 4, 5])
    expect(results.map(r => r.status)).deep.equals([
      'rejected',
      'fulfilled',
      'fulfilled',
      'fulfilled',
      'fulfilled'
    ])
  })
})
