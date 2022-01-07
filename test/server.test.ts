import { makeAppTestKit } from './util/app-test-kit'
import { isErrorResponse } from './utils'

describe('Component: Basic server errors', () => {
  const { agent } = makeAppTestKit()

  it('Can send 404 errors', async () => {
    await agent
      .get('/api/nowhere')
      .send()
      .expect(res => isErrorResponse(404, 'not found')(res))
  })
})
