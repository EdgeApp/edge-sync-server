import { expect } from 'chai'
import { asChangeSet, ChangeSet } from 'edge-sync-client'
import { it } from 'mocha'
import { Response } from 'supertest'

import { makeAppTestKit } from '../util/app-test-kit'
import { isErrorResponse, isSuccessfulResponse, makeEdgeBox } from '../utils'

describe('Component: POST /api/v2/store', () => {
  const { agent, setup, cleanup } = makeAppTestKit()

  const syncKey = '0000000000000000000000000000000000000000'
  let clientCheckpoints = ''

  // Fixtures:

  before(setup)
  before(async () => {
    await agent
      .put(`/api/v2/store/${syncKey}`)
      .expect(res => isSuccessfulResponse(res))
  })
  after(cleanup)

  const isPostStoreResponse = (
    changes: ChangeSet
  ): ((res: Response) => void) => {
    try {
      changes = asChangeSet(changes)
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

  const updateClientCheckpoints = (res: Response): void => {
    clientCheckpoints = res.body.hash
  }

  // Tests:

  it('Can validate syncKey body', async () => {
    const invalidSyncKey = 'invalid'
    await agent
      .post(`/api/v2/store/${invalidSyncKey}/${clientCheckpoints}`)
      .expect(
        isErrorResponse(400, `Invalid sync key '${invalidSyncKey}' at .syncKey`)
      )
  })

  it('Can validate request body', async () => {
    await agent
      .post(`/api/v2/store/${syncKey}/${clientCheckpoints}`)
      .expect(res =>
        isErrorResponse(400, 'Expected an object at .changes')(res)
      )
  })

  it('Can validate paths', async () => {
    const invalidPaths = [
      '',
      ' ',
      'too-far-back/..',
      'way-too/far-back/../..',
      'bad/ space',
      '/leadingslash',
      'trailingslash/'
    ]

    for (const path of invalidPaths) {
      await agent
        .post(`/api/v2/store/${syncKey}/${clientCheckpoints}`)
        .send({
          changes: {
            [path]: makeEdgeBox('content')
          }
        })
        .expect(res => isErrorResponse(400, `Invalid path '${path}'`)(res))
    }
  })

  it('Can write file', async () => {
    const filePath = `file${Math.random()}`
    const changes = {
      [filePath]: makeEdgeBox('content')
    }

    await agent
      .post(`/api/v2/store/${syncKey}/${clientCheckpoints}`)
      .send({
        changes
      })
      .expect(res => isPostStoreResponse(changes)(res))
      .then(updateClientCheckpoints)
  })

  it('Can update file', async () => {
    const filePath = `file${Math.random()}`
    const changesA = {
      [filePath]: makeEdgeBox('content A')
    }
    const changesB = {
      [filePath]: makeEdgeBox('content B')
    }

    await agent
      .post(`/api/v2/store/${syncKey}/${clientCheckpoints}`)
      .send({
        changes: changesA
      })
      .expect(res => isPostStoreResponse(changesA)(res))
      .then(updateClientCheckpoints)
    await agent
      .post(`/api/v2/store/${syncKey}/${clientCheckpoints}`)
      .send({
        changes: changesB
      })
      .expect(res => isPostStoreResponse(changesB)(res))
      .then(updateClientCheckpoints)
  })

  it('Can write file with directory', async () => {
    const filePath = `dir/file${Math.random()}`
    const changes = {
      [filePath]: makeEdgeBox('content')
    }

    await agent
      .post(`/api/v2/store/${syncKey}/${clientCheckpoints}`)
      .send({
        changes
      })
      .expect(res => isPostStoreResponse(changes)(res))
      .then(updateClientCheckpoints)
  })

  it('Can write file where there is a directory', async () => {
    const dirPath = 'dir'
    const filePath = `dir/file${Math.random()}`
    const changes = {
      [filePath]: makeEdgeBox('content')
    }

    await agent
      .post(`/api/v2/store/${syncKey}/${clientCheckpoints}`)
      .send({
        changes
      })
      .expect(res => isPostStoreResponse(changes)(res))
      .then(updateClientCheckpoints)
    await agent
      .post(`/api/v2/store/${syncKey}/${clientCheckpoints}`)
      .send({
        changes: {
          [dirPath]: makeEdgeBox('content')
        }
      })
      .expect(res =>
        isPostStoreResponse({
          [dirPath]: makeEdgeBox('content')
        })(res)
      )
      .then(updateClientCheckpoints)
  })

  it('Can write file where the directory is a file', async () => {
    const filePath = `file${Math.random()}`
    const filePath2 = `${filePath}/file`

    await agent
      .post(`/api/v2/store/${syncKey}/${clientCheckpoints}`)
      .send({
        changes: {
          [filePath]: makeEdgeBox('content')
        }
      })
      .expect(res =>
        isPostStoreResponse({
          [filePath]: makeEdgeBox('content')
        })(res)
      )
      .then(updateClientCheckpoints)
    await agent
      .post(`/api/v2/store/${syncKey}/${clientCheckpoints}`)
      .send({
        changes: {
          [filePath2]: makeEdgeBox('content')
        }
      })
      .expect(res =>
        isPostStoreResponse({
          [filePath2]: makeEdgeBox('content')
        })(res)
      )
      .then(updateClientCheckpoints)
  })

  it('Can delete file', async () => {
    const filePath = `file${Math.random()}`
    const changesA = {
      [filePath]: makeEdgeBox('content')
    }
    const changesB = {
      [filePath]: null
    }

    await agent
      .post(`/api/v2/store/${syncKey}/${clientCheckpoints}`)
      .send({
        changes: changesA
      })
      .expect(res => isPostStoreResponse(changesA)(res))
      .then(updateClientCheckpoints)
    await agent
      .post(`/api/v2/store/${syncKey}/${clientCheckpoints}`)
      .send({
        changes: changesB
      })
      .expect(res => isPostStoreResponse(changesB)(res))
      .then(updateClientCheckpoints)
  })

  it('Can delete non-existing file', async () => {
    const filePath = 'nofile'

    await agent
      .post(`/api/v2/store/${syncKey}/${clientCheckpoints}`)
      .send({
        changes: {
          [filePath]: null
        }
      })
      .expect(res =>
        isPostStoreResponse({
          [filePath]: null
        })(res)
      )
      .then(updateClientCheckpoints)
  })

  it('Cannot delete a file that was previously deleted', async () => {
    const filePath = `file${Math.random()}`
    const changesA = {
      [filePath]: makeEdgeBox('content')
    }
    const changesB = {
      [filePath]: null
    }

    await agent
      .post(`/api/v2/store/${syncKey}/${clientCheckpoints}`)
      .send({
        changes: changesA
      })
      .expect(res => isPostStoreResponse(changesA)(res))
      .then(updateClientCheckpoints)
    await agent
      .post(`/api/v2/store/${syncKey}/${clientCheckpoints}`)
      .send({
        changes: changesB
      })
      .expect(res => isPostStoreResponse(changesB)(res))
      .then(updateClientCheckpoints)
    await agent
      .post(`/api/v2/store/${syncKey}/${clientCheckpoints}`)
      .send({
        changes: {
          [filePath]: null
        }
      })
      .expect(res =>
        isPostStoreResponse({
          [filePath]: null
        })(res)
      )
      .then(updateClientCheckpoints)
  })

  it('Can write files with out-of-date checkpoint', async () => {
    const file1Path = `file1_${Math.random()}`
    const file2Path = `file2_${Math.random()}`
    const file3Path = `file3_${Math.random()}`
    const file4Path = `file4_${Math.random()}`
    const file5Path = `file5_${Math.random()}`

    const changesA = {
      [file1Path]: makeEdgeBox(file1Path)
    }
    const changesB = {
      [file2Path]: makeEdgeBox(file2Path)
    }
    const changesC = {
      [file3Path]: makeEdgeBox(file3Path)
    }
    const changesD = {
      [file4Path]: makeEdgeBox(file4Path)
    }
    const changesE = {
      [file5Path]: makeEdgeBox(file5Path)
    }

    let changesBCheckpoints = ''

    await agent
      .post(`/api/v2/store/${syncKey}/${clientCheckpoints}`)
      .send({
        changes: changesA
      })
      .expect(res => isPostStoreResponse(changesA)(res))

    await agent
      .post(`/api/v2/store/${syncKey}/${clientCheckpoints}`)
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
        changesBCheckpoints = res.body.hash
      })

    await agent
      .post(`/api/v2/store/${syncKey}/${clientCheckpoints}`)
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
      .post(`/api/v2/store/${syncKey}/${changesBCheckpoints}`)
      .send({
        changes: changesD
      })
      .expect(
        isPostStoreResponse({
          ...changesC,
          ...changesD
        })
      )
      .then(updateClientCheckpoints)

    await agent
      .post(`/api/v2/store/${syncKey}/${clientCheckpoints}`)
      .send({
        changes: changesE
      })
      .expect(res => isPostStoreResponse(changesE)(res))
      .then(updateClientCheckpoints)
  })
})
