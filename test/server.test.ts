import supertest from 'supertest'

import { AppState, makeServer } from '../src/server'
import { apiSuite } from './suites'
import { isErrorResponse } from './utils'

apiSuite('Component: Basic server errors', (appState: AppState) => {
  const app = makeServer(appState)
  const agent = supertest.agent(app)

  it('Can send 404 errors', async () => {
    await agent
      .get('/api/nowhere')
      .send()
      .expect(res => isErrorResponse(404, 'not found')(res))
  })
})
