import { expect } from 'chai'
import { it } from 'mocha'
import supertest, { Response } from 'supertest'

import { app } from '../src/server'
import { apiSuite } from './suites'
import {
  isErrorResponse,
  isSuccessfulResponse,
  makeMockStoreFile
} from './utils'

apiSuite('POST /api/v3/updateFiles', () => {
  const agent = supertest.agent(app)

  const repoId = 'test'
  let repoTimestamp = 0

  before(async () => {
    const res = await agent
      .put('/api/v3/repo')
      .send({ repoId })
      .expect(isSuccessfulResponse)
    expect(res.body.data.timestamp).to.be.a('number')
    repoTimestamp = res.body.data.timestamp
  })

  const isUpdateFilesResponse = (res: Response): void => {
    isSuccessfulResponse(res)

    expect(res.body.data, 'res.body.data').to.be.an('object')
    expect(res.body.data.timestamp, 'res.body.data.timestamp').to.be.a('number')
    expect(res.body.data.paths, 'res.body.data.paths').to.be.an('object')
  }

  const updateRepoTimestamp = (res: Response): void => {
    repoTimestamp = res.body.data.timestamp
  }

  it('Can validate request body', async () => {
    await agent
      .post('/api/v3/updateFiles')
      .expect(isErrorResponse(400, 'Expected a string at .repoId'))
    await agent
      .post('/api/v3/updateFiles')
      .send({
        repoId
      })
      .expect(isErrorResponse(400, 'Expected a number at .timestamp'))
    await agent
      .post('/api/v3/updateFiles')
      .send({
        repoId,
        timestamp: repoTimestamp
      })
      .expect(isErrorResponse(400, 'Expected an object at .paths'))
    await agent
      .post('/api/v3/updateFiles')
      .send({
        timestamp: repoTimestamp,
        repoId: '',
        paths: {
          '/file': null
        }
      })
      .expect(isErrorResponse(400, 'Expected non empty string at .repoId'))
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
          repoId,
          timestamp: 0,
          paths: {
            [path]: makeMockStoreFile({ text: 'content' })
          }
        })
        .expect(isErrorResponse(400, `Invalid path '${path}'`))
    }
  })

  it('Can validate file data', async () => {
    await agent
      .post('/api/v3/updateFiles')
      .send({
        repoId,
        timestamp: 0,
        paths: {
          '/file': { wrong: 'shape' }
        }
      })
      .expect(isErrorResponse(400, `Expected null at .paths["/file"]`))
  })

  it('Can write file', async () => {
    const filePath = `/file${Math.random()}`

    await agent
      .post('/api/v3/updateFiles')
      .send({
        repoId,
        timestamp: repoTimestamp,
        paths: {
          [filePath]: makeMockStoreFile({ text: 'content' })
        }
      })
      .expect(isUpdateFilesResponse)
      .expect(updateRepoTimestamp)
  })

  it('Can update file', async () => {
    const filePath = `/file${Math.random()}`

    await agent
      .post('/api/v3/updateFiles')
      .send({
        repoId,
        timestamp: repoTimestamp,
        paths: {
          [filePath]: makeMockStoreFile({ text: 'content' })
        }
      })
      .expect(isUpdateFilesResponse)
      .expect(updateRepoTimestamp)
    await agent
      .post('/api/v3/updateFiles')
      .send({
        repoId,
        timestamp: repoTimestamp,
        paths: {
          [filePath]: makeMockStoreFile({ text: 'content' })
        }
      })
      .expect(isUpdateFilesResponse)
      .expect(updateRepoTimestamp)
  })

  it('Can write file with directory', async () => {
    const filePath = `/dir/file${Math.random()}`

    await agent
      .post('/api/v3/updateFiles')
      .send({
        repoId,
        timestamp: repoTimestamp,
        paths: {
          [filePath]: makeMockStoreFile({ text: 'content' })
        }
      })
      .expect(isUpdateFilesResponse)
      .expect(updateRepoTimestamp)
  })

  it('Cannot write file where there is a directory', async () => {
    const dirPath = '/dir'
    const filePath = `/dir/file${Math.random()}`

    await agent
      .post('/api/v3/updateFiles')
      .send({
        repoId,
        timestamp: repoTimestamp,
        paths: {
          [filePath]: makeMockStoreFile({ text: 'content' })
        }
      })
      .expect(isUpdateFilesResponse)
      .expect(updateRepoTimestamp)
    await agent
      .post('/api/v3/updateFiles')
      .send({
        repoId,
        timestamp: repoTimestamp,
        paths: {
          [dirPath]: makeMockStoreFile({ text: 'content' })
        }
      })
      .expect(
        isErrorResponse(
          422,
          `Unable to write file '${dirPath}'. ` +
            `Existing document is not a file.`
        )
      )
  })

  it('Cannot write file where the directory is a file', async () => {
    const filePath = `/file${Math.random()}`
    const badFilePath = `${filePath}/file'`

    await agent
      .post('/api/v3/updateFiles')
      .send({
        repoId,
        timestamp: repoTimestamp,
        paths: {
          [filePath]: makeMockStoreFile({ text: 'content' })
        }
      })
      .expect(isSuccessfulResponse)
      .expect(updateRepoTimestamp)
    await agent
      .post('/api/v3/updateFiles')
      .send({
        repoId,
        timestamp: repoTimestamp,
        paths: {
          [badFilePath]: makeMockStoreFile({ text: 'content' })
        }
      })
      .expect(
        isErrorResponse(
          422,
          `Unable to write files under '${filePath}'. ` +
            `Existing document is not a directory.`
        )
      )
  })

  it('Can delete file', async () => {
    const filePath = `/file${Math.random()}`

    await agent
      .post('/api/v3/updateFiles')
      .send({
        repoId,
        timestamp: repoTimestamp,
        paths: {
          [filePath]: makeMockStoreFile({ text: 'content' })
        }
      })
      .expect(isUpdateFilesResponse)
      .expect(updateRepoTimestamp)
    await agent
      .post('/api/v3/updateFiles')
      .send({
        repoId,
        timestamp: repoTimestamp,
        paths: {
          [filePath]: null
        }
      })
      .expect(isUpdateFilesResponse)
      .expect(updateRepoTimestamp)
  })

  it('Cannot delete non-existing file', async () => {
    const filePath = '/nofile'

    await agent
      .post('/api/v3/updateFiles')
      .send({
        repoId,
        timestamp: repoTimestamp,
        paths: {
          [filePath]: null
        }
      })
      .expect(
        isErrorResponse(
          422,
          `Unable to delete file '${filePath}'. ` + `Document does not exist.`
        )
      )
  })

  it('Cannot delete a file that was previously deleted', async () => {
    const filePath = `/file${Math.random()}`

    await agent
      .post('/api/v3/updateFiles')
      .send({
        repoId,
        timestamp: repoTimestamp,
        paths: {
          [filePath]: makeMockStoreFile({ text: 'content' })
        }
      })
      .expect(isSuccessfulResponse)
      .expect(updateRepoTimestamp)
    await agent
      .post('/api/v3/updateFiles')
      .send({
        repoId,
        timestamp: repoTimestamp,
        paths: {
          [filePath]: null
        }
      })
      .expect(isSuccessfulResponse)
      .expect(updateRepoTimestamp)
    await agent
      .post('/api/v3/updateFiles')
      .send({
        repoId,
        timestamp: repoTimestamp,
        paths: {
          [filePath]: null
        }
      })
      .expect(
        isErrorResponse(
          422,
          `Unable to delete file '${filePath}'. ` + `File is already deleted.`
        )
      )
  })

  it('Will error with out-of-date timestamp', async () => {
    await agent
      .post('/api/v3/updateFiles')
      .send({
        repoId,
        timestamp: repoTimestamp - 1,
        paths: {
          '/file': makeMockStoreFile({ text: 'content' })
        }
      })
      .expect(isErrorResponse(422, 'Failed due to out-of-date timestamp'))
  })
})
