import { expect } from 'chai'
import { it } from 'mocha'
import supertest from 'supertest'

import { AppState, makeServer } from '../src/server'
import { apiSuite } from './suites'
import { isErrorResponse, isSuccessfulResponse } from './utils'

apiSuite('PUT /api/v3/repo', (appState: AppState) => {
  const app = makeServer(appState)
  const agent = supertest.agent(app)

  const repoId = '0000000000000000000000000000000000000000'

  it('Can validate request body', async () => {
    await agent
      .put('/api/v3/repo')
      .send()
      .expect(isErrorResponse(400, 'Expected a string at .repoId'))
  })

  it('Can validate repo ID', async () => {
    const invalidRepoId = 'invalid'

    await agent
      .put('/api/v3/repo')
      .send({
        repoId: invalidRepoId
      })
      .expect(
        isErrorResponse(400, `Invalid repo ID '${invalidRepoId}' at .repoId`)
      )
  })

  it('Can create new repo', async () => {
    await agent
      .put('/api/v3/repo')
      .send({
        repoId
      })
      .expect(isSuccessfulResponse)
      .expect(201)
      .expect(res => {
        expect(res.body.success).to.equal(true, 'res.body.success')
        expect(res.body.data).to.be.an('object')
        expect(res.body.data.timestamp).to.be.a('string')
      })
  })

  it('Will error for existing repo', async () => {
    await agent
      .put('/api/v3/repo')
      .send({
        repoId
      })
      .expect(isErrorResponse(409))
  })
})
