import { expect } from 'chai'
import { it } from 'mocha'
import supertest from 'supertest'

import { app } from '../src/server'
import { apiSuite } from './suites'
import { delay, isSuccessfulResponse, makeMockStoreFile } from './utils'

apiSuite('/api/v3/getFiles', () => {
  const agent = supertest.agent(app)

  const repoId = 'test'
  const otherRepoId = 'other'
  let repoTimestamp: number = 0
  let oldestTs: number = 0
  let latestTs: number = 0

  const CONTENT = {
    file1: makeMockStoreFile({ text: '/file1 content' }),
    file2: makeMockStoreFile({ text: '/file2 content' }),
    deletedFile: makeMockStoreFile({ text: '/deletedFile content' }),
    dirFile1: makeMockStoreFile({ text: '/dir/file1 content' }),
    dirFile2: makeMockStoreFile({ text: '/dir/file2 content' }),
    dirDeletedFile: makeMockStoreFile({ text: '/dir/deletedFil contente' })
  } as const

  // Fixtures:

  before(async () => {
    // Create test repo
    let res = await agent
      .put('/api/v3/repo')
      .send({ repoId })
      .expect(isSuccessfulResponse)
    expect(res.body.data.timestamp).to.be.a('number')

    repoTimestamp = res.body.data.timestamp

    // Create test files/dirs (first files)
    res = await agent
      .post('/api/v3/updateFiles')
      .send({
        repoId,
        timestamp: repoTimestamp,
        paths: {
          '/file1': CONTENT.file1,
          '/deletedFile': CONTENT.deletedFile,
          '/dir/file1': CONTENT.dirFile1,
          '/dirDeletedFile': CONTENT.dirDeletedFile
        }
      })
      .expect(isSuccessfulResponse)

    oldestTs = repoTimestamp = res.body.data.timestamp

    // Delete files
    res = await agent
      .post('/api/v3/updateFiles')
      .send({
        repoId,
        timestamp: repoTimestamp,
        paths: {
          '/deletedFile': null,
          '/dirDeletedFile': null
        }
      })
      .expect(isSuccessfulResponse)

    repoTimestamp = res.body.data.timestamp

    await delay(10)

    // Create test files/dir (second files)
    res = await agent
      .post('/api/v3/updateFiles')
      .send({
        repoId,
        timestamp: repoTimestamp,
        paths: {
          '/file2': CONTENT.file2,
          '/dir/file2': CONTENT.dirFile2
        }
      })
      .expect(isSuccessfulResponse)

    latestTs = repoTimestamp = res.body.data.timestamp

    // Other repo control (should not be returned)
    res = await agent
      .put('/api/v3/repo')
      .send({ repoId: otherRepoId })
      .expect(isSuccessfulResponse)
    res = await agent
      .post('/api/v3/updateFiles')
      .send({
        repoId: otherRepoId,
        timestamp: res.body.data.timestamp,
        paths: {
          '/file1.ignore': CONTENT.file1,
          '/deletedFile.ignore': CONTENT.deletedFile,
          '/dir/file1.ignore': CONTENT.dirFile1,
          '/dirDeletedFile.ignore': CONTENT.dirDeletedFile
        }
      })
      .expect(isSuccessfulResponse)
    res = await agent
      .post('/api/v3/updateFiles')
      .send({
        repoId: otherRepoId,
        timestamp: res.body.data.timestamp,
        paths: {
          '/deletedFile.ignore': null,
          '/dirDeletedFile.ignore': null
        }
      })
      .expect(isSuccessfulResponse)
  })

  // Tests:

  // Files
  it('Can get files ignoring timestamp', async () => {
    const paths = {
      '/file1': 0,
      '/file2': 0,
      '/dir/file1': 0,
      '/dir/file2': 0
    }

    await agent
      .post('/api/v3/getFiles')
      .send({
        repoId,
        ignoreTimestamps: true,
        paths
      })
      .expect(isSuccessfulResponse)
      .expect(res => {
        expect(res.body.data).deep.equals({
          total: Object.keys(paths).length,
          paths: {
            '/file1': { ...CONTENT.file1, timestamp: oldestTs },
            '/file2': { ...CONTENT.file2, timestamp: latestTs },
            '/dir/file1': {
              ...CONTENT.dirFile1,
              timestamp: oldestTs
            },
            '/dir/file2': {
              ...CONTENT.dirFile2,
              timestamp: latestTs
            }
          }
        })
      })
  })
  it('Can get files with timestamp', async () => {
    // Should return no file because same timestamp
    await agent
      .post('/api/v3/getFiles')
      .send({
        repoId,
        ignoreTimestamps: false,
        paths: {
          '/file1': oldestTs
        }
      })
      .expect(isSuccessfulResponse)
      .expect(res => {
        expect(res.body.data).deep.equals({
          total: 0,
          paths: {}
        })
      })
    // Should return single file because timestamp is decremented
    await agent
      .post('/api/v3/getFiles')
      .send({
        repoId,
        ignoreTimestamps: false,
        paths: {
          '/file1': oldestTs - 1
        }
      })
      .expect(isSuccessfulResponse)
      .expect(res => {
        expect(res.body.data).deep.equals({
          total: 1,
          paths: {
            '/file1': { ...CONTENT.file1, timestamp: oldestTs }
          }
        })
      })
  })

  // Directories
  it('Can get directories ignoring timestamp', async () => {
    await agent
      .post('/api/v3/getFiles')
      .send({
        repoId,
        ignoreTimestamps: true,
        paths: {
          '/dir': 0
        }
      })
      .expect(isSuccessfulResponse)
      .expect(res => {
        expect(res.body.data).deep.equals({
          total: 1,
          paths: {
            '/dir': {
              paths: {
                file1: oldestTs,
                file2: latestTs
              },
              timestamp: latestTs
            }
          }
        })
      })
  })
  it('Can get directories with timestamp', async () => {
    await agent
      .post('/api/v3/getFiles')
      .send({
        repoId,
        ignoreTimestamps: false,
        paths: {
          '/dir': 0
        }
      })
      .expect(isSuccessfulResponse)
      .expect(res => {
        expect(res.body.data).deep.equals({
          total: 1,
          paths: {
            '/dir': {
              paths: {
                file1: oldestTs,
                file2: latestTs
              },
              timestamp: latestTs
            }
          }
        })
      })
    await agent
      .post('/api/v3/getFiles')
      .send({
        repoId,
        ignoreTimestamps: false,
        paths: {
          '/dir': oldestTs
        }
      })
      .expect(isSuccessfulResponse)
      .expect(res => {
        expect(res.body.data).deep.equals({
          total: 1,
          paths: {
            '/dir': {
              paths: {
                file2: latestTs
              },
              timestamp: latestTs
            }
          }
        })
      })
    await agent
      .post('/api/v3/getFiles')
      .send({
        repoId,
        ignoreTimestamps: false,
        paths: {
          '/dir': latestTs
        }
      })
      .expect(isSuccessfulResponse)
      .expect(res => {
        expect(res.body.data).deep.equals({
          total: 0,
          paths: {}
        })
      })
  })

  // Repo
  it('Can get repo ignoring timestamp', async () => {
    await agent
      .post('/api/v3/getFiles')
      .send({
        repoId,
        ignoreTimestamps: true,
        paths: {
          '/': 0
        }
      })
      .expect(isSuccessfulResponse)
      .expect(res => {
        expect(res.body.data).deep.equals({
          total: 1,
          paths: {
            '/': {
              paths: {
                dir: latestTs,
                file1: oldestTs,
                file2: latestTs
              },
              timestamp: latestTs
            }
          }
        })
      })
  })
  it('Can get repo with timestamp', async () => {
    await agent
      .post('/api/v3/getFiles')
      .send({
        repoId,
        ignoreTimestamps: false,
        paths: {
          '/': 0
        }
      })
      .expect(isSuccessfulResponse)
      .expect(res => {
        expect(res.body.data).deep.equals({
          total: 1,
          paths: {
            '/': {
              paths: {
                dir: latestTs,
                file1: oldestTs,
                file2: latestTs
              },
              timestamp: latestTs
            }
          }
        })
      })
    await agent
      .post('/api/v3/getFiles')
      .send({
        repoId,
        ignoreTimestamps: false,
        paths: {
          '/': oldestTs
        }
      })
      .expect(isSuccessfulResponse)
      .expect(res => {
        expect(res.body.data).deep.equals({
          total: 1,
          paths: {
            '/': {
              paths: {
                dir: latestTs,
                file2: latestTs
              },
              timestamp: latestTs
            }
          }
        })
      })
    await agent
      .post('/api/v3/getFiles')
      .send({
        repoId,
        ignoreTimestamps: false,
        paths: {
          '/': latestTs
        }
      })
      .expect(isSuccessfulResponse)
      .expect(res => {
        expect(res.body.data).deep.equals({
          total: 0,
          paths: {}
        })
      })
  })
})
