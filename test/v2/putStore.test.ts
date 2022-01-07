import { it } from 'mocha'

import { makeAppTestKit } from '../util/app-test-kit'
import { isErrorResponse, isSuccessfulResponse } from '../utils'

describe('Component: PUT /api/v2/store', () => {
  const { agent, setup, cleanup } = makeAppTestKit()

  const syncKey = '0000000000000000000000000000000000000000'

  before(setup)
  after(cleanup)

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
