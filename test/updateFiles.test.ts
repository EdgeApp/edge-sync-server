import { sub } from 'biggystring'
import { expect } from 'chai'
import { it } from 'mocha'
import supertest, { Response } from 'supertest'

import { AppState, makeServer } from '../src/server'
import { asTimestampRev, TimestampRev } from '../src/types'
import { apiSuite } from './suites'
import {
  isErrorResponse,
  isSuccessfulResponse,
  makeMockStoreFile
} from './utils'

apiSuite('POST /api/v3/updateFiles', (appState: AppState) => {
  const app = makeServer(appState)
  const agent = supertest.agent(app)

  const syncKey = '0000000000000000000000000000000000000000'
  let repoTimestamp: TimestampRev = asTimestampRev(0)

  before(async () => {
    const res = await agent
      .put('/api/v3/repo')
      .send({ syncKey })
      .expect(res => isSuccessfulResponse(res))
    expect(res.body.data.timestamp).to.be.a('string')
    repoTimestamp = res.body.data.timestamp
  })

  const isUpdateFilesResponse = (res: Response): void => {
    isSuccessfulResponse(res)

    expect(res.body.data, 'res.body.data').to.be.an('object')
    expect(res.body.data.timestamp, 'res.body.data.timestamp').to.be.a('string')
    expect(res.body.data.paths, 'res.body.data.paths').to.be.an('object')
  }

  const updateRepoTimestamp = (res: Response): void => {
    repoTimestamp = res.body.data.timestamp
  }

  it('Can validate request body', async () => {
    await agent
      .post('/api/v3/updateFiles')
      .expect(res => isErrorResponse(400, 'Expected a string at .syncKey')(res))
    await agent
      .post('/api/v3/updateFiles')
      .send({
        syncKey
      })
      .expect(res =>
        isErrorResponse(
          400,
          `Invalid timestamp rev 'undefined' at .timestamp`
        )(res)
      )
    await agent
      .post('/api/v3/updateFiles')
      .send({
        syncKey,
        timestamp: repoTimestamp
      })
      .expect(res => isErrorResponse(400, 'Expected an object at .paths')(res))
    await agent
      .post('/api/v3/updateFiles')
      .send({
        timestamp: repoTimestamp,
        syncKey: '',
        paths: {
          '/file': null
        }
      })
      .expect(res =>
        isErrorResponse(400, `Invalid sync key '' at .syncKey`)(res)
      )
  })

  it('Can validate paths', async () => {
    const invalidPaths = [
      '',
      '/',
      '/ bad/space',
      'has/no/root/slash',
      '/too/many//slashes'
    ]

    for (const path of invalidPaths) {
      await agent
        .post('/api/v3/updateFiles')
        .send({
          syncKey,
          timestamp: 0,
          paths: {
            [path]: makeMockStoreFile({ text: 'content' })
          }
        })
        .expect(res => isErrorResponse(400, `Invalid path '${path}'`)(res))
    }
  })

  it('Can validate file data', async () => {
    await agent
      .post('/api/v3/updateFiles')
      .send({
        syncKey,
        timestamp: 0,
        paths: {
          '/file': { wrong: 'shape' }
        }
      })
      .expect(res =>
        isErrorResponse(400, `Expected null at .paths["/file"]`)(res)
      )
  })

  it('Can write file', async () => {
    const filePath = `/file${Math.random()}`

    await agent
      .post('/api/v3/updateFiles')
      .send({
        syncKey,
        timestamp: repoTimestamp,
        paths: {
          [filePath]: makeMockStoreFile({ text: 'content' })
        }
      })
      .expect(res => isUpdateFilesResponse(res))
      .then(updateRepoTimestamp)
  })

  it('Can update file', async () => {
    const filePath = `/file${Math.random()}`

    await agent
      .post('/api/v3/updateFiles')
      .send({
        syncKey,
        timestamp: repoTimestamp,
        paths: {
          [filePath]: makeMockStoreFile({ text: 'content' })
        }
      })
      .expect(res => isUpdateFilesResponse(res))
      .then(updateRepoTimestamp)
    await agent
      .post('/api/v3/updateFiles')
      .send({
        syncKey,
        timestamp: repoTimestamp,
        paths: {
          [filePath]: makeMockStoreFile({ text: 'content' })
        }
      })
      .expect(res => isUpdateFilesResponse(res))
      .then(updateRepoTimestamp)
  })

  it('Can write file with directory', async () => {
    const filePath = `/dir/file${Math.random()}`

    await agent
      .post('/api/v3/updateFiles')
      .send({
        syncKey,
        timestamp: repoTimestamp,
        paths: {
          [filePath]: makeMockStoreFile({ text: 'content' })
        }
      })
      .expect(res => isUpdateFilesResponse(res))
      .then(updateRepoTimestamp)
  })

  it('Cannot write file where there is a directory', async () => {
    const dirPath = '/dir'
    const filePath = `/dir/file${Math.random()}`

    await agent
      .post('/api/v3/updateFiles')
      .send({
        syncKey,
        timestamp: repoTimestamp,
        paths: {
          [filePath]: makeMockStoreFile({ text: 'content' })
        }
      })
      .expect(res => isUpdateFilesResponse(res))
      .then(updateRepoTimestamp)
    await agent
      .post('/api/v3/updateFiles')
      .send({
        syncKey,
        timestamp: repoTimestamp,
        paths: {
          [dirPath]: makeMockStoreFile({ text: 'content' })
        }
      })
      .expect(res =>
        isErrorResponse(
          422,
          `Unable to write file '${dirPath}'. ` +
            `Existing document is not a file.`
        )(res)
      )
  })

  it('Cannot write file where the directory is a file', async () => {
    const filePath = `/file${Math.random()}`
    const badFilePath = `${filePath}/file'`

    await agent
      .post('/api/v3/updateFiles')
      .send({
        syncKey,
        timestamp: repoTimestamp,
        paths: {
          [filePath]: makeMockStoreFile({ text: 'content' })
        }
      })
      .expect(res => isSuccessfulResponse(res))
      .then(updateRepoTimestamp)
    await agent
      .post('/api/v3/updateFiles')
      .send({
        syncKey,
        timestamp: repoTimestamp,
        paths: {
          [badFilePath]: makeMockStoreFile({ text: 'content' })
        }
      })
      .expect(res =>
        isErrorResponse(
          422,
          `Unable to write files under '${filePath}'. ` +
            `Existing document is not a directory.`
        )(res)
      )
  })

  it('Can delete file', async () => {
    const filePath = `/file${Math.random()}`

    await agent
      .post('/api/v3/updateFiles')
      .send({
        syncKey,
        timestamp: repoTimestamp,
        paths: {
          [filePath]: makeMockStoreFile({ text: 'content' })
        }
      })
      .expect(res => isUpdateFilesResponse(res))
      .then(updateRepoTimestamp)
    await agent
      .post('/api/v3/updateFiles')
      .send({
        syncKey,
        timestamp: repoTimestamp,
        paths: {
          [filePath]: null
        }
      })
      .expect(res => isUpdateFilesResponse(res))
      .then(updateRepoTimestamp)
  })

  it('Cannot delete non-existing file', async () => {
    const filePath = '/nofile'

    await agent
      .post('/api/v3/updateFiles')
      .send({
        syncKey,
        timestamp: repoTimestamp,
        paths: {
          [filePath]: null
        }
      })
      .expect(res =>
        isErrorResponse(
          422,
          `Unable to delete file '${filePath}'. ` + `Document does not exist.`
        )(res)
      )
  })

  it('Cannot delete a file that was previously deleted', async () => {
    const filePath = `/file${Math.random()}`

    await agent
      .post('/api/v3/updateFiles')
      .send({
        syncKey,
        timestamp: repoTimestamp,
        paths: {
          [filePath]: makeMockStoreFile({ text: 'content' })
        }
      })
      .expect(res => isSuccessfulResponse(res))
      .then(updateRepoTimestamp)
    await agent
      .post('/api/v3/updateFiles')
      .send({
        syncKey,
        timestamp: repoTimestamp,
        paths: {
          [filePath]: null
        }
      })
      .expect(res => isSuccessfulResponse(res))
      .then(updateRepoTimestamp)
    await agent
      .post('/api/v3/updateFiles')
      .send({
        syncKey,
        timestamp: repoTimestamp,
        paths: {
          [filePath]: null
        }
      })
      .expect(res =>
        isErrorResponse(
          422,
          `Unable to delete file '${filePath}'. ` + `File is already deleted.`
        )(res)
      )
  })

  it('Will error with out-of-date timestamp', async () => {
    await agent
      .post('/api/v3/updateFiles')
      .send({
        syncKey,
        timestamp: sub(repoTimestamp, '1'),
        paths: {
          '/file': makeMockStoreFile({ text: 'content' })
        }
      })
      .expect(res =>
        isErrorResponse(422, 'Failed due to out-of-date timestamp')(res)
      )
  })
})
