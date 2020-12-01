import { expect } from 'chai'
import { it } from 'mocha'
import supertest from 'supertest'

import { app } from '../../src/server'
import { apiSuite } from '../suites'
import {
  delay,
  isErrorResponse,
  isSuccessfulResponse,
  makeMockStoreFile
} from '../utils'

apiSuite('GET /api/v2/store', () => {
  const agent = supertest.agent(app)

  const repoId = 'test'
  const otherRepoId = 'other'
  let repoTimestamp: number = 0
  let oldestTs: number = 0
  let deletionTs: number = 0
  let latestTs: number = 0

  const CONTENT = {
    file1: makeMockStoreFile({ text: '/file1 content' }),
    file2: makeMockStoreFile({ text: '/file2 content' }),
    deletedFile: makeMockStoreFile({ text: '/deletedFile content' }),
    dirFile1: makeMockStoreFile({ text: '/dir/file1 content' }),
    dirFile2: makeMockStoreFile({ text: '/dir/file2 content' }),
    dirDeletedFile: makeMockStoreFile({ text: '/dir/deletedFile content' })
  } as const

  // Fixtures:

  before(async () => {
    // Create test repo
    let res = await agent
      .put('/api/v3/repo')
      .send({ repoId })
      .expect(isSuccessfulResponse)

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
          '/dir/deletedFile': CONTENT.dirDeletedFile
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
          '/dir/deletedFile': null
        }
      })
      .expect(isSuccessfulResponse)

    deletionTs = repoTimestamp = res.body.data.timestamp

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
          '/dir/deletedFile.ignore': CONTENT.dirDeletedFile
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
          '/dir/deletedFile.ignore': null
        }
      })
      .expect(isSuccessfulResponse)
  })

  // Tests:

  it('will return 404 for non-existing repos', async () => {
    await agent
      .get(`/api/v2/store/none/0`)
      .expect(isErrorResponse(404, `Repo 'none' not found`))
  })

  it('can get updates with 0 timestamp parameter', async () => {
    await agent
      .get(`/api/v2/store/${repoId}/0`)
      .expect(isSuccessfulResponse)
      .expect(res => {
        expect(res.body.hash).equals(repoTimestamp.toString())
        expect(res.body.changes).deep.equals({
          file1: CONTENT.file1.box,
          'dir/file1': CONTENT.dirFile1.box,
          'dir/file2': CONTENT.dirFile2.box,
          file2: CONTENT.file2.box,
          deletedFile: null,
          'dir/deletedFile': null
        })
      })
  })

  it('can get updates with specific timestamp', async () => {
    await agent
      .get(`/api/v2/store/${repoId}/${oldestTs}`)
      .expect(isSuccessfulResponse)
      .expect(res => {
        expect(res.body.hash).equals(repoTimestamp.toString())
        expect(res.body.changes).deep.equals({
          'dir/file2': CONTENT.dirFile2.box,
          file2: CONTENT.file2.box,
          deletedFile: null,
          'dir/deletedFile': null
        })
      })
    await agent
      .get(`/api/v2/store/${repoId}/${deletionTs}`)
      .expect(isSuccessfulResponse)
      .expect(res => {
        expect(res.body.hash).equals(repoTimestamp.toString())
        expect(res.body.changes).deep.equals({
          'dir/file2': CONTENT.dirFile2.box,
          file2: CONTENT.file2.box
        })
      })
    await agent
      .get(`/api/v2/store/${repoId}/${latestTs}`)
      .expect(isSuccessfulResponse)
      .expect(res => {
        expect(res.body.hash).equals(repoTimestamp.toString())
        expect(res.body.changes).deep.equals({})
      })
  })
})
