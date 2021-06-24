import { expect } from 'chai'
import { it } from 'mocha'
import supertest from 'supertest'

import { AppState, makeServer } from '../../src/server'
import { asTimestampRev, TimestampRev } from '../../src/types'
import { apiSuite } from '../suites'
import {
  delay,
  isErrorResponse,
  isSuccessfulResponse,
  makeEdgeBox
} from '../utils'

apiSuite('Component: GET /api/v2/store', (appState: AppState) => {
  const app = makeServer(appState)
  const agent = supertest.agent(app)

  const syncKey = '0000000000000000000000000000000000000000'
  const otherSyncKey = '1111111111111111111111111111111111111111'
  let repoTimestamp: TimestampRev = asTimestampRev(0)
  let oldestTs: TimestampRev = asTimestampRev(0)
  let deletionTs: TimestampRev = asTimestampRev(0)
  let latestTs: TimestampRev = asTimestampRev(0)

  const CONTENT = {
    file1: makeEdgeBox('file1 content'),
    file2: makeEdgeBox('file2 content'),
    deletedFile: makeEdgeBox('deletedFile content'),
    dirFile1: makeEdgeBox('dir/file1 content'),
    dirFile2: makeEdgeBox('dir/file2 content'),
    dirDeletedFile: makeEdgeBox('dir/deletedFile content')
  } as const

  // Fixtures:

  before(async () => {
    // Create test repo
    let res = await agent
      .put(`/api/v2/store/${syncKey}`)
      .expect(res => isSuccessfulResponse(res))

    repoTimestamp = res.body.hash

    // Create test files/dirs (first files)
    res = await agent
      .post(`/api/v2/store/${syncKey}/${repoTimestamp}`)
      .send({
        changes: {
          file1: CONTENT.file1,
          deletedFile: CONTENT.deletedFile,
          'dir/file1': CONTENT.dirFile1,
          'dir/deletedFile': CONTENT.dirDeletedFile
        }
      })
      .expect(res => isSuccessfulResponse(res))

    oldestTs = repoTimestamp = res.body.hash

    // Delete files
    res = await agent
      .post(`/api/v2/store/${syncKey}/${repoTimestamp}`)
      .send({
        changes: {
          deletedFile: null,
          'dir/deletedFile': null
        }
      })
      .expect(res => isSuccessfulResponse(res))

    deletionTs = repoTimestamp = res.body.hash

    await delay(10)

    // Create test files/dir (second files)
    res = await agent
      .post(`/api/v2/store/${syncKey}/${repoTimestamp}`)
      .send({
        changes: {
          file2: CONTENT.file2,
          'dir/file2': CONTENT.dirFile2
        }
      })
      .expect(res => isSuccessfulResponse(res))

    latestTs = repoTimestamp = res.body.hash

    // Other repo control (should not be returned)
    res = await agent
      .put(`/api/v2/store/${otherSyncKey}`)
      .expect(res => isSuccessfulResponse(res))
    res = await agent
      .post(`/api/v2/store/${otherSyncKey}/${res.body.hash as string}`)
      .send({
        changes: {
          'file1.ignore': CONTENT.file1,
          'deletedFile.ignore': CONTENT.deletedFile,
          'dir/file1.ignore': CONTENT.dirFile1,
          'dir/deletedFile.ignore': CONTENT.dirDeletedFile
        }
      })
      .expect(res => isSuccessfulResponse(res))
    res = await agent
      .post(`/api/v2/store/${otherSyncKey}/${res.body.hash as string}`)
      .send({
        changes: {
          'deletedFile.ignore': null,
          'dir/deletedFile.ignore': null
        }
      })
      .expect(res => isSuccessfulResponse(res))
  })

  // Tests:

  it('will return 404 for non-existing repos', async () => {
    const unknownSyncKey = 'e7707e7707e7707e7707e7707e7707e7707e7707'
    await agent
      .get(`/api/v2/store/${unknownSyncKey}/0`)
      .expect(res => isErrorResponse(404, `Repo not found`)(res))
  })

  it('can get updates with no hash parameter', async () => {
    await agent
      .get(`/api/v2/store/${syncKey}/`)
      .expect(res => isSuccessfulResponse(res))
      .expect(res => {
        expect(res.body.hash).equals(repoTimestamp.toString())
        expect(res.body.changes).deep.equals({
          file1: CONTENT.file1,
          'dir/file1': CONTENT.dirFile1,
          'dir/file2': CONTENT.dirFile2,
          file2: CONTENT.file2,
          deletedFile: null,
          'dir/deletedFile': null
        })
      })
  })

  it('can get updates with hash parameter', async () => {
    await agent
      .get(`/api/v2/store/${syncKey}/abcdef1234567890abcdef1234567890`)
      .expect(res => isSuccessfulResponse(res))
      .expect(res => {
        expect(res.body.hash).equals(repoTimestamp.toString())
        expect(res.body.changes).deep.equals({
          file1: CONTENT.file1,
          'dir/file1': CONTENT.dirFile1,
          'dir/file2': CONTENT.dirFile2,
          file2: CONTENT.file2,
          deletedFile: null,
          'dir/deletedFile': null
        })
      })
  })

  it('can get updates with 0 timestamp parameter', async () => {
    await agent
      .get(`/api/v2/store/${syncKey}/0`)
      .expect(res => isSuccessfulResponse(res))
      .expect(res => {
        expect(res.body.hash).equals(repoTimestamp.toString())
        expect(res.body.changes).deep.equals({
          file1: CONTENT.file1,
          'dir/file1': CONTENT.dirFile1,
          'dir/file2': CONTENT.dirFile2,
          file2: CONTENT.file2,
          deletedFile: null,
          'dir/deletedFile': null
        })
      })
  })

  it('can get updates with specific timestamp', async () => {
    await agent
      .get(`/api/v2/store/${syncKey}/${oldestTs}`)
      .expect(res => isSuccessfulResponse(res))
      .expect(res => {
        expect(res.body.hash).equals(repoTimestamp.toString())
        expect(res.body.changes).deep.equals({
          'dir/file2': CONTENT.dirFile2,
          file2: CONTENT.file2,
          deletedFile: null,
          'dir/deletedFile': null
        })
      })
    await agent
      .get(`/api/v2/store/${syncKey}/${deletionTs}`)
      .expect(res => isSuccessfulResponse(res))
      .expect(res => {
        expect(res.body.hash).equals(repoTimestamp.toString())
        expect(res.body.changes).deep.equals({
          'dir/file2': CONTENT.dirFile2,
          file2: CONTENT.file2
        })
      })
    await agent
      .get(`/api/v2/store/${syncKey}/${latestTs}`)
      .expect(res => isSuccessfulResponse(res))
      .expect(res => {
        expect(res.body.hash).equals(repoTimestamp.toString())
        expect(res.body.changes).deep.equals({})
      })
  })
})
