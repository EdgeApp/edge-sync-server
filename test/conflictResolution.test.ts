import { add, sub } from 'biggystring'
import { expect } from 'chai'
import { it } from 'mocha'
import supertest from 'supertest'

import { timestampSubVersion } from '../src/api/conflictResolution'
import { makeServer } from '../src/server'
import { TimestampRev } from '../src/types'
import { replicationSuite } from './suites'
import {
  isSuccessfulResponse,
  makeMockStoreFile,
  synchronizeServers
} from './utils'

replicationSuite('Conflict resolution', (appStateA, appStateB) => {
  const agentA = supertest.agent(makeServer(appStateA))
  const agentB = supertest.agent(makeServer(appStateB))

  // Map of repo timestamps
  const repoTimestamps: { [K: string]: TimestampRev } = {}

  const syncKey = '0000000000000000000000000000000000000000'
  const CONTENT = {
    mergeBaseContent: makeMockStoreFile({ text: 'Merge base content' }),
    updateAContent: makeMockStoreFile({ text: 'Update A content' }),
    updateBContent: makeMockStoreFile({ text: 'Update B content' })
  } as const

  const getResponseTimestamp = (res: supertest.Response): TimestampRev =>
    res.body.data.timestamp

  // Fixtures:

  before(async () => {
    // Create test repo with initial non-conflicting files (merge base)
    await agentA
      .put('/api/v3/repo')
      .send({ syncKey })
      .expect(res => isSuccessfulResponse(res))
      .expect(res => expect(res.body.data.timestamp).to.be.a('string'))
      .expect(res => (repoTimestamps.mergedBase = getResponseTimestamp(res)))

    await agentA
      .post('/api/v3/updateFiles')
      .send({
        syncKey,
        timestamp: repoTimestamps.mergedBase,
        paths: {
          '/mergeBaseFile': CONTENT.mergeBaseContent,
          '/conflictDir/mergeBaseFile': CONTENT.mergeBaseContent
        }
      })
      .expect(res => isSuccessfulResponse(res))
      .expect(res => (repoTimestamps.mergedBase = getResponseTimestamp(res)))

    await synchronizeServers(appStateA, appStateB)

    // After merge base:

    // Create first conflicting update (update A)

    await agentA
      .post('/api/v3/updateFiles')
      .send({
        syncKey,
        timestamp: repoTimestamps.mergedBase,
        paths: {
          '/nonConflictFile': CONTENT.updateAContent,
          '/conflictFile': CONTENT.updateAContent,
          '/conflictDir/conflictFile': CONTENT.updateAContent,
          '/conflictDirOrFile': CONTENT.updateAContent
        }
      })
      .expect(res => isSuccessfulResponse(res))
      .expect(res => (repoTimestamps.updateA = getResponseTimestamp(res)))

    // Create second conflicting update (update B)

    await agentB
      .post('/api/v3/updateFiles')
      .send({
        syncKey,
        timestamp: repoTimestamps.mergedBase,
        paths: {
          '/conflictFile': CONTENT.updateBContent,
          '/conflictDir/conflictFile': CONTENT.updateBContent,
          '/conflictDirOrFile/file': CONTENT.updateBContent
        }
      })
      .expect(res => isSuccessfulResponse(res))
      .expect(res => (repoTimestamps.updateB = getResponseTimestamp(res)))

    // Expected merge timestamp rev
    repoTimestamps.mergedRev = add(
      repoTimestamps.updateB,
      timestampSubVersion([repoTimestamps.updateA])
    )

    // Synchronize both servers
    await synchronizeServers(appStateA, appStateB)
    await synchronizeServers(appStateB, appStateA)
  })

  // Tests:

  it('/api/v3/getFiles returns merged conflicting documents', async () => {
    const isExpected = (res: supertest.Response): void => {
      expect(res.body.data.paths).deep.equals({
        '/nonConflictFile': {
          ...CONTENT.updateAContent,
          timestamp: repoTimestamps.updateA
        },
        '/conflictFile': {
          ...CONTENT.updateBContent,
          timestamp: repoTimestamps.mergedRev
        },
        '/conflictDir/conflictFile': {
          ...CONTENT.updateBContent,
          timestamp: repoTimestamps.mergedRev
        },
        '/conflictDirOrFile': {
          paths: { file: repoTimestamps.updateB },
          timestamp: repoTimestamps.mergedRev
        }
      })
    }

    await agentA
      .post('/api/v3/getFiles')
      .send({
        syncKey,
        ignoreTimestamps: true,
        paths: {
          '/nonConflictFile': 0,
          '/conflictFile': 0,
          '/conflictDir/conflictFile': 0,
          '/conflictDirOrFile': 0
        }
      })
      .expect(res => isSuccessfulResponse(res))
      .expect(res => isExpected(res))

    await agentB
      .post('/api/v3/getFiles')
      .send({
        syncKey,
        ignoreTimestamps: true,
        paths: {
          '/nonConflictFile': 0,
          '/conflictFile': 0,
          '/conflictDir/conflictFile': 0,
          '/conflictDirOrFile': 0
        }
      })
      .expect(res => isSuccessfulResponse(res))
      .expect(res => isExpected(res))
  })

  it('/api/v3/getFiles returns merged timestamps given a directory path', async () => {
    const isExpected = (res: supertest.Response): void => {
      expect(res.body.data.paths).deep.equals({
        '/conflictDir': {
          paths: {
            conflictFile: repoTimestamps.mergedRev,
            mergeBaseFile: repoTimestamps.mergedBase
          },
          timestamp: repoTimestamps.mergedRev
        }
      })
    }

    await agentA
      .post('/api/v3/getFiles')
      .send({
        syncKey,
        ignoreTimestamps: false,
        paths: {
          '/conflictDir': 0
        }
      })
      .expect(res => isSuccessfulResponse(res))
      .expect(res => isExpected(res))

    await agentB
      .post('/api/v3/getFiles')
      .send({
        syncKey,
        ignoreTimestamps: false,
        paths: {
          '/conflictDir': 0
        }
      })
      .expect(res => isSuccessfulResponse(res))
      .expect(res => isExpected(res))
  })

  it('/api/v3/getUpdates returns merged timestamps correctly', async () => {
    const isExpected = (res: supertest.Response): void => {
      expect(res.body.data.paths).deep.equals({
        '/mergeBaseFile': repoTimestamps.mergedBase,
        '/nonConflictFile': repoTimestamps.updateA,
        '/conflictFile': repoTimestamps.mergedRev,
        '/conflictDir/conflictFile': repoTimestamps.mergedRev,
        '/conflictDir/mergeBaseFile': repoTimestamps.mergedBase,
        '/conflictDirOrFile/file': repoTimestamps.updateB
      })
      expect(res.body.data.deleted).deep.equals({})
    }

    await agentA
      .post('/api/v3/getUpdates')
      .send({
        syncKey,
        timestamp: 0
      })
      .expect(res => isSuccessfulResponse(res))
      .expect(res => isExpected(res))

    await agentB
      .post('/api/v3/getUpdates')
      .send({
        syncKey,
        timestamp: 0
      })
      .expect(res => isSuccessfulResponse(res))
      .expect(res => isExpected(res))
  })

  it('/api/v3/getUpdates returns updates after merge base given latest timestamp', async () => {
    const isExpected = (res: supertest.Response): void => {
      expect(res.body.data.paths).deep.equals({
        '/nonConflictFile': repoTimestamps.updateA,
        '/conflictFile': repoTimestamps.mergedRev,
        '/conflictDir/conflictFile': repoTimestamps.mergedRev,
        '/conflictDirOrFile/file': repoTimestamps.updateB
      })
      expect(res.body.data.deleted).deep.equals({})
    }

    await agentA
      .post('/api/v3/getUpdates')
      .send({
        syncKey,
        timestamp: repoTimestamps.updateB
      })
      .expect(res => isSuccessfulResponse(res))
      .expect(res => isExpected(res))

    await agentB
      .post('/api/v3/getUpdates')
      .send({
        syncKey,
        timestamp: repoTimestamps.updateB
      })
      .expect(res => isSuccessfulResponse(res))
      .expect(res => isExpected(res))
  })

  it('/api/v3/getUpdates returns updates after merge base given non-latest timestamp revision', async () => {
    const isExpected = (res: supertest.Response): void => {
      expect(res.body.data.paths).deep.equals({
        '/nonConflictFile': repoTimestamps.updateA,
        '/conflictFile': repoTimestamps.mergedRev,
        '/conflictDir/conflictFile': repoTimestamps.mergedRev,
        '/conflictDirOrFile/file': repoTimestamps.updateB
      })
      expect(res.body.data.deleted).deep.equals({})
    }

    const nonLatestTimestampRev = sub(
      repoTimestamps.mergedRev,
      '0.000000000000001'
    )

    await agentA
      .post('/api/v3/getUpdates')
      .send({
        syncKey,
        timestamp: nonLatestTimestampRev
      })
      .expect(res => isSuccessfulResponse(res))
      .expect(res => isExpected(res))

    await agentB
      .post('/api/v3/getUpdates')
      .send({
        syncKey,
        timestamp: nonLatestTimestampRev
      })
      .expect(res => isSuccessfulResponse(res))
      .expect(res => isExpected(res))
  })

  it('/api/v3/getUpdates returns no updates given latest timestamp revision', async () => {
    const isExpected = (res: supertest.Response): void => {
      expect(res.body.data.paths).deep.equals({})
      expect(res.body.data.deleted).deep.equals({})
    }

    await agentA
      .post('/api/v3/getUpdates')
      .send({
        syncKey,
        timestamp: repoTimestamps.mergedRev
      })
      .expect(res => isSuccessfulResponse(res))
      .expect(res => isExpected(res))

    await agentB
      .post('/api/v3/getUpdates')
      .send({
        syncKey,
        timestamp: repoTimestamps.mergedRev
      })
      .expect(res => isSuccessfulResponse(res))
      .expect(res => isExpected(res))
  })

  it('/api/v3/updateFiles will resolve conflicts', async () => {
    await agentA
      .post('/api/v3/updateFiles')
      .send({
        syncKey,
        timestamp: repoTimestamps.mergedRev,
        paths: {
          '/conflictFile': CONTENT.updateAContent,
          '/conflictDir/conflictFile': CONTENT.updateAContent,
          '/conflictDirOrFile/file': CONTENT.updateAContent
        }
      })
      .expect(res => isSuccessfulResponse(res))
      .expect(res => (repoTimestamps.resolveUpdate = getResponseTimestamp(res)))

    expect(
      repoTimestamps.resolveUpdate.split('.').length === 1,
      'resolved update timestamp should not contain a sub-version'
    )

    await synchronizeServers(appStateA, appStateB)

    await agentB
      .post('/api/v3/getUpdates')
      .send({
        syncKey,
        timestamp: repoTimestamps.mergedBase
      })
      .expect(res => isSuccessfulResponse(res))
      .expect(res => {
        expect(res.body.data.paths).deep.equals({
          '/nonConflictFile': repoTimestamps.updateA,
          '/conflictFile': repoTimestamps.resolveUpdate,
          '/conflictDir/conflictFile': repoTimestamps.resolveUpdate,
          '/conflictDirOrFile/file': repoTimestamps.resolveUpdate
        })
        expect(res.body.data.deleted).deep.equals({})
      })
  })
})
