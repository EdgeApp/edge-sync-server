import supertest from 'supertest'

import { app } from '../src/server'
import { apiSuite } from './suites'
import { isErrorResponse } from './utils'

apiSuite('Basic server errors', () => {
  const agent = supertest.agent(app)

  it('Can send 404 errors', async () => {
    await agent
      .get('/api/v3/nowhere')
      .send()
      .expect(isErrorResponse(404, 'not found'))
  })
})
