import { expect } from 'chai'

import { intersectTimestampHistory } from '../../src/api/conflictResolution'
import { asTimestampRev, TimestampHistory } from '../../src/types'

describe('Unit: intersectTimestampHistory', () => {
  it('Will intersect on identical sets', () => {
    const shared: TimestampHistory = [
      {
        timestamp: asTimestampRev(300),
        rev: '3-aaa'
      },
      {
        timestamp: asTimestampRev(200),
        rev: '2-aaa'
      },
      {
        timestamp: asTimestampRev(100),
        rev: '1-aaa'
      }
    ]
    const left: TimestampHistory = [...shared]
    const right: TimestampHistory = [...shared]

    expect(intersectTimestampHistory(left, right)).to.deep.equal(shared)
  })
  it('Will intersect on sets sharing items', () => {
    const shared: TimestampHistory = [
      {
        timestamp: asTimestampRev(200),
        rev: '2-aaa'
      },
      {
        timestamp: asTimestampRev(100),
        rev: '1-aaa'
      }
    ]
    const left: TimestampHistory = [
      {
        timestamp: asTimestampRev(401),
        rev: '4-aaa'
      },
      {
        timestamp: asTimestampRev(301),
        rev: '3-aaa'
      },
      ...shared
    ]
    const right: TimestampHistory = [
      {
        timestamp: asTimestampRev(402),
        rev: '4-bbb'
      },
      {
        timestamp: asTimestampRev(302),
        rev: '3-bbb'
      },
      ...shared
    ]

    expect(intersectTimestampHistory(left, right)).to.deep.equal(shared)
  })
  it('Will not intersect on sets with no shared items', () => {
    const left: TimestampHistory = [
      { timestamp: asTimestampRev(400), rev: '4-aaa' },
      { timestamp: asTimestampRev(300), rev: '3-aaa' },
      { timestamp: asTimestampRev(200), rev: '2-aaa' },
      { timestamp: asTimestampRev(100), rev: '1-aaa' }
    ]
    const right: TimestampHistory = [
      { timestamp: asTimestampRev(400), rev: '4-bbb' },
      { timestamp: asTimestampRev(300), rev: '3-bbb' },
      { timestamp: asTimestampRev(200), rev: '2-bbb' },
      { timestamp: asTimestampRev(100), rev: '1-bbb' }
    ]

    expect(intersectTimestampHistory(left, right)).to.deep.equal([])
  })
})
