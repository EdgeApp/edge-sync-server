import { expect } from 'chai'
import { it } from 'mocha'
import supertest, { Response } from 'supertest'

import { AppState, makeServer } from '../../src/server'
import { asTimestampRev, TimestampRev } from '../../src/types'
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

  const syncKey = '0000000000000000000000000000000000000000'
  let repoTimestamp = 0

  // Fixtures:

  before(async () => {
    const res = await agent
      .put('/api/v3/repo')
      .send({ syncKey })
      .expect(res => isSuccessfulResponse(res))
    expect(res.body.data.timestamp).to.be.a('string')
    repoTimestamp = res.body.data.timestamp
  })

  const isPostStoreResponse = (
    changes: ChangeSetV2
  ): ((res: Response) => void) => {
    try {
      changes = asChangeSetV2(changes)
    } catch (error) {
      throw new Error(
        `Invalid changes arg for isPostStoreResponse: ${JSON.stringify(
          error.message
        )}`
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

  it('Can validate syncKey body', async () => {
    const invalidSyncKey = 'invalid'
    await agent
      .post(`/api/v2/store/${invalidSyncKey}/${repoTimestamp}`)
      .expect(
        isErrorResponse(400, `Invalid sync key '${invalidSyncKey}' at .syncKey`)
      )
  })

  it('Can validate request body', async () => {
    await agent
      .post(`/api/v2/store/${syncKey}/${repoTimestamp}`)
      .expect(res =>
        isErrorResponse(400, 'Expected an object at .changes')(res)
      )
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
        .post(`/api/v2/store/${syncKey}/${repoTimestamp}`)
        .send({
          changes: {
            [path]: makeMockStoreFile({ text: 'content' }).box
          }
        })
        .expect(res => isErrorResponse(400, `Invalid path '/${path}'`)(res))
    }
  })

  it('Can write file', async () => {
    const filePath = `file${Math.random()}`
    const changes = {
      [filePath]: makeMockStoreFile({ text: 'content' }).box
    }

    await agent
      .post(`/api/v2/store/${syncKey}/${repoTimestamp}`)
      .send({
        changes
      })
      .expect(res => isPostStoreResponse(changes)(res))
      .then(updateRepoTimestamp)
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
      .post(`/api/v2/store/${syncKey}/${repoTimestamp}`)
      .send({
        changes: changesA
      })
      .expect(res => isPostStoreResponse(changesA)(res))
      .then(updateRepoTimestamp)
    await agent
      .post(`/api/v2/store/${syncKey}/${repoTimestamp}`)
      .send({
        changes: changesB
      })
      .expect(res => isPostStoreResponse(changesB)(res))
      .then(updateRepoTimestamp)
  })

  it('Can write file with directory', async () => {
    const filePath = `dir/file${Math.random()}`
    const changes = {
      [filePath]: makeMockStoreFile({ text: 'content' }).box
    }

    await agent
      .post(`/api/v2/store/${syncKey}/${repoTimestamp}`)
      .send({
        changes
      })
      .expect(res => isPostStoreResponse(changes)(res))
      .then(updateRepoTimestamp)
  })

  it('Cannot write file where there is a directory', async () => {
    const dirPath = 'dir'
    const filePath = `dir/file${Math.random()}`
    const changes = {
      [filePath]: makeMockStoreFile({ text: 'content' }).box
    }

    await agent
      .post(`/api/v2/store/${syncKey}/${repoTimestamp}`)
      .send({
        changes
      })
      .expect(res => isPostStoreResponse(changes)(res))
      .then(updateRepoTimestamp)
    await agent
      .post(`/api/v2/store/${syncKey}/${repoTimestamp}`)
      .send({
        changes: {
          [dirPath]: makeMockStoreFile({ text: 'content' }).box
        }
      })
      .expect(res =>
        isErrorResponse(
          422,
          `Unable to write file '/${dirPath}'. ` +
            `Existing document is not a file.`
        )(res)
      )
  })

  it('Cannot write file where the directory is a file', async () => {
    const filePath = `file${Math.random()}`
    const badFilePath = `${filePath}/file'`
    const changes = {
      [filePath]: makeMockStoreFile({ text: 'content' }).box
    }

    await agent
      .post(`/api/v2/store/${syncKey}/${repoTimestamp}`)
      .send({
        changes
      })
      .expect(res => isPostStoreResponse(changes)(res))
      .then(updateRepoTimestamp)
    await agent
      .post(`/api/v2/store/${syncKey}/${repoTimestamp}`)
      .send({
        changes: {
          [badFilePath]: makeMockStoreFile({ text: 'content' }).box
        }
      })
      .expect(res =>
        isErrorResponse(
          422,
          `Unable to write files under '/${filePath}'. ` +
            `Existing document is not a directory.`
        )(res)
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
      .post(`/api/v2/store/${syncKey}/${repoTimestamp}`)
      .send({
        changes: changesA
      })
      .expect(res => isPostStoreResponse(changesA)(res))
      .then(updateRepoTimestamp)
    await agent
      .post(`/api/v2/store/${syncKey}/${repoTimestamp}`)
      .send({
        changes: changesB
      })
      .expect(res => isPostStoreResponse(changesB)(res))
      .then(updateRepoTimestamp)
  })

  it('Cannot delete non-existing file', async () => {
    const filePath = 'nofile'

    await agent
      .post(`/api/v2/store/${syncKey}/${repoTimestamp}`)
      .send({
        changes: {
          [filePath]: null
        }
      })
      .expect(res =>
        isErrorResponse(
          422,
          `Unable to delete file '/${filePath}'. ` + `Document does not exist.`
        )(res)
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
      .post(`/api/v2/store/${syncKey}/${repoTimestamp}`)
      .send({
        changes: changesA
      })
      .expect(res => isPostStoreResponse(changesA)(res))
      .then(updateRepoTimestamp)
    await agent
      .post(`/api/v2/store/${syncKey}/${repoTimestamp}`)
      .send({
        changes: changesB
      })
      .expect(res => isPostStoreResponse(changesB)(res))
      .then(updateRepoTimestamp)
    await agent
      .post(`/api/v2/store/${syncKey}/${repoTimestamp}`)
      .send({
        changes: {
          [filePath]: null
        }
      })
      .expect(res =>
        isErrorResponse(
          422,
          `Unable to delete file '/${filePath}'. ` + `File is already deleted.`
        )(res)
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

    let changesBTimestamp: TimestampRev = asTimestampRev(0)

    await agent
      .post(`/api/v2/store/${syncKey}/${repoTimestamp}`)
      .send({
        changes: changesA
      })
      .expect(res => isPostStoreResponse(changesA)(res))

    await agent
      .post(`/api/v2/store/${syncKey}/${repoTimestamp}`)
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
        changesBTimestamp = asTimestampRev(res.body.hash)
      })

    await agent
      .post(`/api/v2/store/${syncKey}/${repoTimestamp}`)
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
      .post(`/api/v2/store/${syncKey}/${changesBTimestamp}`)
      .send({
        changes: changesD
      })
      .expect(
        isPostStoreResponse({
          ...changesC,
          ...changesD
        })
      )
      .then(updateRepoTimestamp)

    await agent
      .post(`/api/v2/store/${syncKey}/${repoTimestamp}`)
      .send({
        changes: changesE
      })
      .expect(res => isPostStoreResponse(changesE)(res))
      .then(updateRepoTimestamp)
  })
})
