import { expect } from 'chai'

import { timestampSubVersion } from '../../src/api/conflictResolution'

describe('Unit: timestampSubVersion', () => {
  it('Can generate sub-version from timestamps', () => {
    const timestamps = ['1200', '2090', '3011']
    const expectation = '0.0000000000006301'

    const result = timestampSubVersion(timestamps)

    expect(result).to.equal(expectation)
  })
  it('Can generate sub-version from timestamps with sub-versions', () => {
    const timestamps = [
      '1000.0001000000000100',
      '2000.0000000000000300',
      '3000.0001000000000500'
    ]
    const expectation = '0.00020000000069'

    const result = timestampSubVersion(timestamps)

    expect(result).to.equal(expectation)
  })
  it('Can generate sub-version from timestamps with and without sub-versions', () => {
    const timestamps = [
      '1000.0001000000000100',
      '2000.0000000000000300',
      '3000.0001000000000500',
      '50000',
      '100000',
      '200000'
    ]
    const expectation = '0.00020000003569'

    const result = timestampSubVersion(timestamps)

    expect(result).to.equal(expectation)
  })
  it('Can generate sub-version from empty array', () => {
    const result = timestampSubVersion([])

    expect(result).to.equal('0')
  })
})
