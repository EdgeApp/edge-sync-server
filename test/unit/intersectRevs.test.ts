import { expect } from 'chai'

import { intersectRevs } from '../../src/api/conflictResolution'

describe('Unit: intersectRevs', () => {
  it('Will intersect on identical sets', () => {
    const revs = [
      '3-1234567890abcdef1234567890abcdef',
      '2-1234567890abcdef1234567890abcdef',
      '1-1234567890abcdef1234567890abcdef'
    ]
    const leftRevs = [...revs]
    const rightRevs = [...revs]

    expect(intersectRevs(leftRevs, rightRevs)).to.deep.equal(revs)
  })
  it('Will intersect on sets sharing revs', () => {
    const sharedRevs = [
      '2-1234567890abcdef1234567890abcdef',
      '1-1234567890abcdef1234567890abcdef'
    ]
    const leftRevs = [
      '4-1234567890abcdef1234567890abcdef',
      '3-1234567890abcdef1234567890abcdef',
      ...sharedRevs
    ]
    const rightRevs = [
      '4-abcdef1234567890abcdef1234567890',
      '3-abcdef1234567890abcdef1234567890',
      ...sharedRevs
    ]

    expect(intersectRevs(leftRevs, rightRevs)).to.deep.equal(sharedRevs)
  })
  it('Will not intersect on sets with no shared revs', () => {
    const leftRevs = [
      '4-1234567890abcdef1234567890abcdef',
      '3-1234567890abcdef1234567890abcdef',
      '2-1234567890abcdef1234567890abcdef',
      '1-1234567890abcdef1234567890abcdef'
    ]
    const rightRevs = [
      '4-abcdef1234567890abcdef1234567890',
      '3-abcdef1234567890abcdef1234567890',
      '2-abcdef1234567890abcdef1234567890',
      '1-abcdef1234567890abcdef1234567890'
    ]

    expect(intersectRevs(leftRevs, rightRevs)).to.deep.equal([])
  })
})
