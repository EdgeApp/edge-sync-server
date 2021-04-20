import { expect } from 'chai'
import supertest from 'supertest'

import { AppState, makeServer } from '../src/server'
import { apiSuite } from './suites'
import { isErrorResponse, isSuccessfulResponse } from './utils'

apiSuite('Basic server errors', (appState: AppState) => {
  const app = makeServer(appState)
  const agent = supertest.agent(app)

  it('Can send 404 errors', async () => {
    await agent
      .get('/api/v3/nowhere')
      .send()
      .expect(res => isErrorResponse(404, 'not found')(res))
  })
})

apiSuite('/api/v3/config', (appState: AppState) => {
  const app = makeServer(appState)
  const agent = supertest.agent(app)

  it('Can retrieve config', async () => {
    await agent
      .get('/api/v3/config')
      .send()
      .expect(res => isSuccessfulResponse(res))
      .expect(res => {
        expect(res.body.data).to.have.property('maxPageSize')
      })
  })
})
