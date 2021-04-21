import { expect } from 'chai'
import { it } from 'mocha'
import supertest from 'supertest'

import { AppState, makeServer } from '../src/server'
import { apiSuite } from './suites'
import { isErrorResponse, isSuccessfulResponse } from './utils'

apiSuite('PUT /api/v3/repo', (appState: AppState) => {
  const app = makeServer(appState)
  const agent = supertest.agent(app)

  const syncKey = '0000000000000000000000000000000000000000'

  it('Can validate request body', async () => {
    await agent
      .put('/api/v3/repo')
      .send()
      .expect(res => isErrorResponse(400, 'Expected a string at .syncKey')(res))
  })

  it('Can validate repo ID', async () => {
    const invalidSyncKey = 'invalid'

    await agent
      .put('/api/v3/repo')
      .send({
        syncKey: invalidSyncKey
      })
      .expect(res =>
        isErrorResponse(
          400,
          `Invalid sync key '${invalidSyncKey}' at .syncKey`
        )(res)
      )
  })

  it('Can create new repo', async () => {
    await agent
      .put('/api/v3/repo')
      .send({
        syncKey
      })
      .expect(res => isSuccessfulResponse(res))
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
        syncKey
      })
      .expect(res => isErrorResponse(409)(res))
  })
})
