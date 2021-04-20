import { expect } from 'chai'
import { it } from 'mocha'
import supertest from 'supertest'

import { AppState, makeServer } from '../../src/server'
import { apiSuite } from '../suites'
import { isErrorResponse, isSuccessfulResponse } from '../utils'

apiSuite('PUT /api/v2/store', (appState: AppState) => {
  const app = makeServer(appState)
  const agent = supertest.agent(app)

  const repoId = '0000000000000000000000000000000000000000'

  it('Missing request parameter', async () => {
    await agent
      .put('/api/v2/store/')
      .send()
      .expect(res => isErrorResponse(404, 'not found')(res))
  })

  it('Can create new repo', async () => {
    await agent
      .put(`/api/v2/store/${repoId}`)
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
      .put(`/api/v2/store/${repoId}`)
      .expect(res => isErrorResponse(409)(res))
  })
})
