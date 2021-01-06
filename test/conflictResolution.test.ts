import { expect } from 'chai'
import { it } from 'mocha'
import supertest from 'supertest'

import { makeServer } from '../src/server'
import { replicationSuite } from './suites'
import {
  isSuccessfulResponse,
  makeMockStoreFile,
  synchronizeServers
} from './utils'

replicationSuite('Conflict resolution', (appStateA, appStateB) => {
  const agentA = supertest.agent(makeServer(appStateA))
  const agentB = supertest.agent(makeServer(appStateB))

  let winningUpdateTimestamp: number

  const repoTimestamps = {
    A: 0,
    B: 0
  }

  const repoId = '0000000000000000000000000000000000000000'
  const CONTENT = {
    fileA: makeMockStoreFile({ text: 'fileA content' }),
    fileB: makeMockStoreFile({ text: 'fileB content' })
  } as const

  const getRepoTimestamp = (res: supertest.Response): number =>
    res.body.data.timestamp
  const setRepoTimestamp = (key: string, timestamp: number): number =>
    (repoTimestamps[key] = timestamp)

  // Fixtures:

  before(async () => {
    // Create test repo
    await agentA
      .put('/api/v3/repo')
      .send({ repoId })
      .expect(res => isSuccessfulResponse(res))
      .expect(res => expect(res.body.data.timestamp).to.be.a('number'))
      .expect(res => setRepoTimestamp('A', getRepoTimestamp(res)))

    await synchronizeServers(appStateA, appStateB)
    setRepoTimestamp('B', repoTimestamps.A)

    await agentA
      .post('/api/v3/updateFiles')
      .send({
        repoId,
        timestamp: repoTimestamps.A,
        paths: {
          '/conflictFile': CONTENT.fileA,
          '/conflictDir/conflictFile': CONTENT.fileA,
          '/conflictDirOrFile': CONTENT.fileA
        }
      })
      .expect(res => isSuccessfulResponse(res))
      .expect(res => setRepoTimestamp('A', getRepoTimestamp(res)))

    await agentB
      .post('/api/v3/updateFiles')
      .send({
        repoId,
        timestamp: repoTimestamps.B,
        paths: {
          '/conflictFile': CONTENT.fileB,
          '/conflictDir/conflictFile': CONTENT.fileB,
          '/conflictDirOrFile/file': CONTENT.fileB
        }
      })
      .expect(res => isSuccessfulResponse(res))
      .expect(res => setRepoTimestamp('B', getRepoTimestamp(res)))

    winningUpdateTimestamp = repoTimestamps.B

    await synchronizeServers(appStateA, appStateB)
    await synchronizeServers(appStateB, appStateA)
    setRepoTimestamp('A', repoTimestamps.B)
  })

  // Tests:

  it('/api/v3/getFiles can resolve conflicts', async () => {
    await agentA
      .post('/api/v3/getFiles')
      .send({
        repoId,
        ignoreTimestamps: true,
        paths: {
          '/conflictFile': 0,
          '/conflictDir/conflictFile': 0,
          '/conflictDirOrFile': 0
        }
      })
      .expect(res => isSuccessfulResponse(res))
      .expect(res => {
        expect(res.body.data.paths).deep.equals({
          '/conflictFile': {
            ...CONTENT.fileB,
            timestamp: winningUpdateTimestamp
          },
          '/conflictDir/conflictFile': {
            ...CONTENT.fileB,
            timestamp: winningUpdateTimestamp
          },
          '/conflictDirOrFile': {
            paths: { file: winningUpdateTimestamp },
            timestamp: winningUpdateTimestamp
          }
        })
      })

    await agentB
      .post('/api/v3/getFiles')
      .send({
        repoId,
        ignoreTimestamps: true,
        paths: {
          '/conflictFile': 0,
          '/conflictDir/conflictFile': 0,
          '/conflictDirOrFile': 0
        }
      })
      .expect(res => isSuccessfulResponse(res))
      .expect(res => {
        expect(res.body.data.paths).deep.equals({
          '/conflictFile': {
            ...CONTENT.fileB,
            timestamp: winningUpdateTimestamp
          },
          '/conflictDir/conflictFile': {
            ...CONTENT.fileB,
            timestamp: winningUpdateTimestamp
          },
          '/conflictDirOrFile': {
            paths: { file: winningUpdateTimestamp },
            timestamp: winningUpdateTimestamp
          }
        })
      })
  })

  it('/api/v3/getUpdates can resolve conflicts', async () => {
    await agentA
      .post('/api/v3/getUpdates')
      .send({
        repoId,
        timestamp: 0
      })
      .expect(res => isSuccessfulResponse(res))
      .expect(res => {
        expect(res.body.data.paths).deep.equals({
          '/conflictFile': winningUpdateTimestamp,
          '/conflictDir/conflictFile': winningUpdateTimestamp,
          '/conflictDirOrFile/file': winningUpdateTimestamp
        })
        expect(res.body.data.deleted).deep.equals({})
      })

    await agentB
      .post('/api/v3/getUpdates')
      .send({
        repoId,
        timestamp: 0
      })
      .expect(res => isSuccessfulResponse(res))
      .expect(res => {
        expect(res.body.data.paths).deep.equals({
          '/conflictFile': winningUpdateTimestamp,
          '/conflictDir/conflictFile': winningUpdateTimestamp,
          '/conflictDirOrFile/file': winningUpdateTimestamp
        })
        expect(res.body.data.deleted).deep.equals({})
      })
  })

  it('/api/v3/updateFiles will resolve conflicts', async () => {
    await agentA
      .post('/api/v3/updateFiles')
      .send({
        repoId,
        timestamp: repoTimestamps.A,
        paths: {
          '/conflictFile': CONTENT.fileA,
          '/conflictDir/conflictFile': CONTENT.fileA,
          '/conflictDirOrFile/file': CONTENT.fileA
        }
      })
      .expect(res => isSuccessfulResponse(res))
      .expect(res => setRepoTimestamp('A', getRepoTimestamp(res)))

    winningUpdateTimestamp = repoTimestamps.A

    await synchronizeServers(appStateA, appStateB)
    setRepoTimestamp('B', repoTimestamps.A)

    await agentB
      .post('/api/v3/getUpdates')
      .send({
        repoId,
        timestamp: 0
      })
      .expect(res => isSuccessfulResponse(res))
      .expect(res => {
        expect(res.body.data.paths).deep.equals({
          '/conflictFile': winningUpdateTimestamp,
          '/conflictDir/conflictFile': winningUpdateTimestamp,
          '/conflictDirOrFile/file': winningUpdateTimestamp
        })
        expect(res.body.data.deleted).deep.equals({})
      })
  })
})
