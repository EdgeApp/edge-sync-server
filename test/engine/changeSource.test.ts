import { expect } from 'chai'
import { describe, it } from 'mocha'

import { config } from '../../src/config'
import {
  docIdToRepoId,
  makeCouchChangeSource
} from '../../src/engine/changeSource'
import { delay } from '../utils'

describe('Unit: docIdToRepoId', () => {
  it('reads the partition prefix', () => {
    expect(docIdToRepoId('abc:path/file.json')).equals('abc')
    expect(docIdToRepoId('abc:')).equals('abc')
    expect(docIdToRepoId('_design/versioning')).equals(undefined)
    expect(docIdToRepoId('_local:thing')).equals(undefined)
    expect(docIdToRepoId(':nothing')).equals(undefined)
    expect(docIdToRepoId('nopartition')).equals(undefined)
  })
})

describe('Component: makeCouchChangeSource', () => {
  it('reports errors without throwing, and stops cleanly while backing off', async () => {
    const errors: unknown[] = []
    let polls = 0
    const source = makeCouchChangeSource({
      couchUri: config.couchUri,
      databaseName: 'sync_store_does_not_exist',
      timeoutMs: 1000
    })(
      {
        onChanges() {},
        onPoll() {
          polls += 1
        },
        onError(error) {
          errors.push(error)
        }
      },
      'now'
    )
    for (let i = 0; i < 50 && errors.length === 0; ++i) await delay(20)
    expect(errors.length).equals(1)
    expect(source.since).equals('now')
    source.stop()
    await delay(1200)
    expect(errors.length).equals(1)
    expect(polls).equals(0)
  })
})
