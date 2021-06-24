import { it } from 'mocha'
import supertest from 'supertest'

import { AppState, makeServer } from '../../src/server'
import { apiSuite } from '../suites'
import { isErrorResponse, isSuccessfulResponse } from '../utils'

apiSuite('PUT /api/v2/store', (appState: AppState) => {
  const app = makeServer(appState)
  const agent = supertest.agent(app)

  const syncKey = '0000000000000000000000000000000000000000'

  it('Missing request parameter', async () => {
    await agent
      .put('/api/v2/store/')
      .send()
      .expect(res => isErrorResponse(404, 'not found')(res))
  })

  it('Can create new repo', async () => {
    await agent
      .put(`/api/v2/store/${syncKey}`)
      .expect(res => isSuccessfulResponse(res))
      .expect(201)
  })

  it('Will error for existing repo', async () => {
    await agent
      .put(`/api/v2/store/${syncKey}`)
      .expect(res => isErrorResponse(409)(res))
  })
})
