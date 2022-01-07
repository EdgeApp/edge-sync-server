import { expect } from 'chai'
import { GetStoreResponse } from 'edge-sync-client'
import { it } from 'mocha'
import supertest from 'supertest'

import { makeAppTestKit } from '../util/app-test-kit'
import { isSuccessfulResponse } from '../utils'

describe('Component: Passive migration', () => {
  const { agent, appState, setup, cleanup } = makeAppTestKit()

  const v2Hostnames = appState.config.migrationOriginServers.map(
    url => new URL(url).hostname
  )
  const v2Agents = v2Hostnames.map(hostname =>
    supertest.agent(`https://${hostname}`)
  )

  const syncKey = appState.config.testMigrationSyncKey
  let repoStoreContent: GetStoreResponse

  // Fixtures:

  before(setup)
  before(async function () {
    if (process.env.TEST_MIGRATION == null) this.skip()

    // Get the repo/store data from one of the V2 servers
    const responses = await Promise.all(
      v2Agents.map(v2Agent => v2Agent.get(`/api/v2/store/${syncKey}`))
    )

    const successfulResponse = responses.find(res => res.status === 200)

    if (successfulResponse == null) {
      throw new Error(
        'Unable to find testMigrationRepo in any of the migrationOriginServers'
      )
    }

    repoStoreContent = successfulResponse.body
  })
  after(cleanup)

  // Tests:

  it('GET /api/v2/store passive migration', async function () {
    if (process.env.TEST_MIGRATION == null) this.skip()

    const res = await agent
      .get(`/api/v2/store/${syncKey}`)
      .expect(res => isSuccessfulResponse(res))

    expect(res.body.changes).to.deep.equal(repoStoreContent.changes)
    expect(res.body.hash != null, 'Missing hash field in response')
  })
})
