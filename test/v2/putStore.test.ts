import { expect } from 'chai'
import { it } from 'mocha'
import supertest from 'supertest'

import { app } from '../../src/server'
import { apiSuite } from '../suites'
import { isErrorResponse, isSuccessfulResponse } from '../utils'

apiSuite('PUT /api/v2/store', () => {
  const agent = supertest.agent(app)

  it('Missing request parameter', async () => {
    await agent
      .put('/api/v2/store/')
      .send()
      .expect(isErrorResponse(404, 'not found'))
  })

  it('Can create new repo', async () => {
    await agent
      .put('/api/v2/store/test')
      .expect(isSuccessfulResponse)
      .expect(201)
      .expect(res => {
        expect(res.body.success).to.equal(true, 'res.body.success')
        expect(res.body.data).to.be.an('object')
        expect(res.body.data.timestamp).to.be.a('number')
      })
  })

  it('Will error for existing repo', async () => {
    await agent.put('/api/v2/store/test').expect(isErrorResponse(409))
  })
})
