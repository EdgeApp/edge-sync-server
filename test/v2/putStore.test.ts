import { it } from 'mocha'

import {
  accessSettingsDocumentKey,
  getSettingsDatabaseSetup
} from '../../src/db/settings-db'
import { AccessSettings } from '../../src/types/settings-types'
import { makeAppTestKit, randomDatabaseName } from '../util/app-test-kit'
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

describe('Component: PUT /api/v2/store apiKey whitelisting', () => {
  const testApiKey1 = `abc123def456`
  const testApiKey2 = `zyx987wvu654`
  const accessSettings: AccessSettings = {
    ipWhitelist: {},
    apiKeyWhitelist: {
      [testApiKey1]: true,
      [testApiKey2]: true
    }
  }
  const { agent, setup, cleanup } = makeAppTestKit({
    settingsDatabaseSetup: randomDatabaseName({
      ...getSettingsDatabaseSetup(),
      templates: {
        [accessSettingsDocumentKey]: accessSettings
      }
    })
  })
  const syncKey1 = '0000000000000000000000000000000000000000'
  const syncKey2 = '0000000000000000000000000000000000000001'

  before(setup)
  after(cleanup)

  it('will block requests without an apiKey', async () => {
    await agent
      .put(`/api/v2/store/${syncKey1}`)
      .expect(res => isErrorResponse(403)(res))
  })
  it('will block requests with invalid apiKey', async () => {
    await agent
      .put(`/api/v2/store/${syncKey1}`)
      .set('X-API-Key', 'you shall not pass')
      .expect(res => isErrorResponse(403)(res))
  })
  it('will accept requests with valid apiKey', async () => {
    await agent
      .put(`/api/v2/store/${syncKey1}`)
      .set('X-API-Key', testApiKey1)
      .expect(res => isSuccessfulResponse(res))
    await agent
      .put(`/api/v2/store/${syncKey2}`)
      .set('X-API-Key', testApiKey2)
      .expect(res => isSuccessfulResponse(res))
  })
})
