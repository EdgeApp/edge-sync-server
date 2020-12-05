import { expect } from 'chai'
import { it } from 'mocha'
import supertest, { Response } from 'supertest'

import { app } from '../../src/server'
import { apiSuite } from '../suites'
import { isErrorResponse, isSuccessfulResponse } from '../utils'

apiSuite('POST /api/v2/store', () => {
  const agent = supertest.agent(app)

  const repoId = 'test'
  let repoTimestamp = 0

  // Fixtures:

  before(async () => {
    const res = await agent
      .put('/api/v3/repo')
      .send({ repoId })
      .expect(isSuccessfulResponse)
    expect(res.body.data.timestamp).to.be.a('number')
    repoTimestamp = res.body.data.timestamp
  })

  const isPostStoreResponse = (res: Response): void => {
    isSuccessfulResponse(res)

    expect(res.body.hash, 'res.body.hash').to.be.a('string')
    expect(res.body.changes, 'res.body.changes').to.be.an('object')
  }

  const updateRepoTimestamp = (res: Response): void => {
    repoTimestamp = parseInt(res.body.hash)
  }

  // Tests:

  it('Can validate request body', async () => {
    await agent
      .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
      .expect(isErrorResponse(400, 'Expected an object at .changes'))
  })

  it('Can validate paths', async () => {
    const invalidPaths = [
      '',
      'bad/ space',
      '/has/root/slash',
      'too/many//slashes'
    ]

    for (const path of invalidPaths) {
      await agent
        .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
        .send({
          changes: {
            [path]: { text: 'content' }
          }
        })
        .expect(isErrorResponse(400, `Invalid path '/${path}'`))
    }
  })

  it('Can write file', async () => {
    const filePath = `file${Math.random()}`

    await agent
      .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
      .send({
        changes: {
          [filePath]: { text: 'content' }
        }
      })
      .expect(isPostStoreResponse)
      .expect(updateRepoTimestamp)
  })

  it('Can update file', async () => {
    const filePath = `file${Math.random()}`

    await agent
      .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
      .send({
        changes: {
          [filePath]: { text: 'content' }
        }
      })
      .expect(isPostStoreResponse)
      .expect(updateRepoTimestamp)
    await agent
      .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
      .send({
        changes: {
          [filePath]: { text: 'content' }
        }
      })
      .expect(isPostStoreResponse)
      .expect(updateRepoTimestamp)
  })

  it('Can write file with directory', async () => {
    const filePath = `dir/file${Math.random()}`

    await agent
      .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
      .send({
        changes: {
          [filePath]: { text: 'content' }
        }
      })
      .expect(isPostStoreResponse)
      .expect(updateRepoTimestamp)
  })

  it('Cannot write file where there is a directory', async () => {
    const dirPath = 'dir'
    const filePath = `dir/file${Math.random()}`

    await agent
      .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
      .send({
        changes: {
          [filePath]: { text: 'content' }
        }
      })
      .expect(isPostStoreResponse)
      .expect(updateRepoTimestamp)
    await agent
      .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
      .send({
        changes: {
          [dirPath]: { text: 'content' }
        }
      })
      .expect(
        isErrorResponse(
          422,
          `Unable to write file '/${dirPath}'. ` +
            `Existing document is not a file.`
        )
      )
  })

  it('Cannot write file where the directory is a file', async () => {
    const filePath = `file${Math.random()}`
    const badFilePath = `${filePath}/file'`

    await agent
      .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
      .send({
        changes: {
          [filePath]: { text: 'content' }
        }
      })
      .expect(isPostStoreResponse)
      .expect(updateRepoTimestamp)
    await agent
      .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
      .send({
        changes: {
          [badFilePath]: { text: 'content' }
        }
      })
      .expect(
        isErrorResponse(
          422,
          `Unable to write files under '/${filePath}'. ` +
            `Existing document is not a directory.`
        )
      )
  })

  it('Can delete file', async () => {
    const filePath = `file${Math.random()}`

    await agent
      .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
      .send({
        changes: {
          [filePath]: { text: 'content' }
        }
      })
      .expect(isPostStoreResponse)
      .expect(updateRepoTimestamp)
    await agent
      .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
      .send({
        changes: {
          [filePath]: null
        }
      })
      .expect(isPostStoreResponse)
      .expect(updateRepoTimestamp)
  })

  it('Cannot delete non-existing file', async () => {
    const filePath = 'nofile'

    await agent
      .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
      .send({
        changes: {
          [filePath]: null
        }
      })
      .expect(
        isErrorResponse(
          422,
          `Unable to delete file '/${filePath}'. ` + `Document does not exist.`
        )
      )
  })

  it('Cannot delete a file that was previously deleted', async () => {
    const filePath = `file${Math.random()}`

    await agent
      .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
      .send({
        changes: {
          [filePath]: { text: 'content' }
        }
      })
      .expect(isPostStoreResponse)
      .expect(updateRepoTimestamp)
    await agent
      .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
      .send({
        changes: {
          [filePath]: null
        }
      })
      .expect(isPostStoreResponse)
      .expect(updateRepoTimestamp)
    await agent
      .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
      .send({
        changes: {
          [filePath]: null
        }
      })
      .expect(
        isErrorResponse(
          422,
          `Unable to delete file '/${filePath}'. ` + `File is already deleted.`
        )
      )
  })

  it('Can write files with out-of-date timestamp', async () => {
    const file1Path = `file1 ${Math.random()}`
    const file1Content = { text: file1Path }
    const file2Path = `file2 ${Math.random()}`
    const file2Content = { text: file2Path }
    const file3Path = `file3 ${Math.random()}`
    const file3Content = { text: file3Path }
    const file4Path = `file4 ${Math.random()}`
    const file4Content = { text: file4Path }
    const file5Path = `file5 ${Math.random()}`
    const file5Content = { text: file5Path }
    let file2Timestamp: number = 0

    await agent
      .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
      .send({
        changes: {
          [file1Path]: file1Content
        }
      })
      .expect(isPostStoreResponse)
      .expect(res => {
        expect(res.body.changes).deep.equals({})
      })

    await agent
      .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
      .send({
        changes: {
          [file2Path]: file2Content
        }
      })
      .expect(isPostStoreResponse)
      .expect(res => {
        file2Timestamp = parseInt(res.body.hash)
        expect(res.body.changes).deep.equals({
          [file1Path]: file1Content
        })
      })

    await agent
      .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
      .send({
        changes: {
          [file3Path]: file3Content
        }
      })
      .expect(isPostStoreResponse)
      .expect(res => {
        expect(res.body.changes).deep.equals({
          [file1Path]: file1Content,
          [file2Path]: file2Content
        })
      })

    await agent
      .post(`/api/v2/store/${repoId}/${file2Timestamp}`)
      .send({
        changes: {
          [file4Path]: file4Content
        }
      })
      .expect(isPostStoreResponse)
      .expect(res => {
        expect(res.body.changes).deep.equals({
          [file3Path]: file3Content
        })
      })
      .expect(updateRepoTimestamp)

    await agent
      .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
      .send({
        changes: {
          [file5Path]: file5Content
        }
      })
      .expect(isPostStoreResponse)
      .expect(res => {
        expect(res.body.changes).deep.equals({})
      })
      .expect(updateRepoTimestamp)
  })
})
