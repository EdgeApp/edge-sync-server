import { expect } from 'chai'
import supertest from 'supertest'

import { app } from '../src/server'
import { apiSuite } from './suites'
import { isErrorResponse, isSuccessfulResponse } from './utils'

apiSuite('Basic server errors', () => {
  const agent = supertest.agent(app)

  it('Can send 404 errors', async () => {
    await agent
      .get('/api/v3/nowhere')
      .send()
      .expect(isErrorResponse(404, 'not found'))
  })
})

apiSuite('/api/v3/config', () => {
  const agent = supertest.agent(app)

  it('Can retrieve config', async () => {
    await agent
      .get('/api/v3/config')
      .send()
      .expect(isSuccessfulResponse)
      .expect(res => {
        expect(res.body.data).to.have.property('maxPageSize')
      })
  })
})
