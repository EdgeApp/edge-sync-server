import { expect } from 'chai'
import { it } from 'mocha'
import supertest, { Response } from 'supertest'

import { AppState, makeServer } from '../../src/server'
import { asChangeSetV2, ChangeSetV2 } from '../../src/v2/types'
import { apiSuite } from '../suites'
import {
  isErrorResponse,
  isSuccessfulResponse,
  makeMockStoreFile
} from '../utils'

apiSuite('POST /api/v2/store', (appState: AppState) => {
  const app = makeServer(appState)
  const agent = supertest.agent(app)

  const repoId = '0000000000000000000000000000000000000000'
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

  const isPostStoreResponse = (
    changes: ChangeSetV2
  ): ((res: Response) => void) => {
    try {
      changes = asChangeSetV2(changes)
    } catch (error) {
      throw new Error(
        `Invalid changes arg for isPostStoreResponse: ${error.message}`
      )
    }

    return (res: Response): void => {
      isSuccessfulResponse(res)

      expect(res.body.hash, 'res.body.hash').to.be.a('string')
      expect(res.body.changes, 'res.body.changes').deep.equals(changes)
    }
  }

  const updateRepoTimestamp = (res: Response): void => {
    repoTimestamp = parseInt(res.body.hash)
  }

  // Tests:

  it('Can validate repoId body', async () => {
    const invalidRepoId = 'invalid'
    await agent
      .post(`/api/v2/store/${invalidRepoId}/${repoTimestamp}`)
      .expect(
        isErrorResponse(400, `Invalid repo ID '${invalidRepoId}' at .storeId`)
      )
  })

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
            [path]: makeMockStoreFile({ text: 'content' }).box
          }
        })
        .expect(isErrorResponse(400, `Invalid path '/${path}'`))
    }
  })

  it('Can write file', async () => {
    const filePath = `file${Math.random()}`
    const changes = {
      [filePath]: makeMockStoreFile({ text: 'content' }).box
    }

    await agent
      .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
      .send({
        changes
      })
      .expect(isPostStoreResponse(changes))
      .expect(updateRepoTimestamp)
  })

  it('Can update file', async () => {
    const filePath = `file${Math.random()}`
    const changesA = {
      [filePath]: makeMockStoreFile({ text: 'content A' }).box
    }
    const changesB = {
      [filePath]: makeMockStoreFile({ text: 'content B' }).box
    }

    await agent
      .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
      .send({
        changes: changesA
      })
      .expect(isPostStoreResponse(changesA))
      .expect(updateRepoTimestamp)
    await agent
      .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
      .send({
        changes: changesB
      })
      .expect(isPostStoreResponse(changesB))
      .expect(updateRepoTimestamp)
  })

  it('Can write file with directory', async () => {
    const filePath = `dir/file${Math.random()}`
    const changes = {
      [filePath]: makeMockStoreFile({ text: 'content' }).box
    }

    await agent
      .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
      .send({
        changes
      })
      .expect(isPostStoreResponse(changes))
      .expect(updateRepoTimestamp)
  })

  it('Cannot write file where there is a directory', async () => {
    const dirPath = 'dir'
    const filePath = `dir/file${Math.random()}`
    const changes = {
      [filePath]: makeMockStoreFile({ text: 'content' }).box
    }

    await agent
      .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
      .send({
        changes
      })
      .expect(isPostStoreResponse(changes))
      .expect(updateRepoTimestamp)
    await agent
      .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
      .send({
        changes: {
          [dirPath]: makeMockStoreFile({ text: 'content' }).box
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
    const changes = {
      [filePath]: makeMockStoreFile({ text: 'content' }).box
    }

    await agent
      .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
      .send({
        changes
      })
      .expect(isPostStoreResponse(changes))
      .expect(updateRepoTimestamp)
    await agent
      .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
      .send({
        changes: {
          [badFilePath]: makeMockStoreFile({ text: 'content' }).box
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
    const changesA = {
      [filePath]: makeMockStoreFile({ text: 'content' }).box
    }
    const changesB = {
      [filePath]: null
    }

    await agent
      .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
      .send({
        changes: changesA
      })
      .expect(isPostStoreResponse(changesA))
      .expect(updateRepoTimestamp)
    await agent
      .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
      .send({
        changes: changesB
      })
      .expect(isPostStoreResponse(changesB))
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
    const changesA = {
      [filePath]: makeMockStoreFile({ text: 'content' }).box
    }
    const changesB = {
      [filePath]: null
    }

    await agent
      .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
      .send({
        changes: changesA
      })
      .expect(isPostStoreResponse(changesA))
      .expect(updateRepoTimestamp)
    await agent
      .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
      .send({
        changes: changesB
      })
      .expect(isPostStoreResponse(changesB))
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
    const file2Path = `file2 ${Math.random()}`
    const file3Path = `file3 ${Math.random()}`
    const file4Path = `file4 ${Math.random()}`
    const file5Path = `file5 ${Math.random()}`

    const changesA = {
      [file1Path]: makeMockStoreFile({ text: file1Path }).box
    }
    const changesB = {
      [file2Path]: makeMockStoreFile({ text: file2Path }).box
    }
    const changesC = {
      [file3Path]: makeMockStoreFile({ text: file3Path }).box
    }
    const changesD = {
      [file4Path]: makeMockStoreFile({ text: file4Path }).box
    }
    const changesE = {
      [file5Path]: makeMockStoreFile({ text: file5Path }).box
    }

    let changesBTimestamp: number = 0

    await agent
      .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
      .send({
        changes: changesA
      })
      .expect(isPostStoreResponse(changesA))

    await agent
      .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
      .send({
        changes: changesB
      })
      .expect(
        isPostStoreResponse({
          ...changesA,
          ...changesB
        })
      )
      .expect(res => {
        changesBTimestamp = parseInt(res.body.hash)
      })

    await agent
      .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
      .send({
        changes: changesC
      })
      .expect(
        isPostStoreResponse({
          ...changesA,
          ...changesB,
          ...changesC
        })
      )

    await agent
      .post(`/api/v2/store/${repoId}/${changesBTimestamp}`)
      .send({
        changes: changesD
      })
      .expect(
        isPostStoreResponse({
          ...changesC,
          ...changesD
        })
      )
      .expect(updateRepoTimestamp)

    await agent
      .post(`/api/v2/store/${repoId}/${repoTimestamp}`)
      .send({
        changes: changesE
      })
      .expect(isPostStoreResponse(changesE))
      .expect(updateRepoTimestamp)
  })
})
