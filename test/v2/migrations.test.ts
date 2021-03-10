import { expect } from 'chai'
import { it } from 'mocha'
import supertest from 'supertest'

import { AppState, makeServer } from '../../src/server'
import { GetStoreResponse } from '../../src/types'
import { apiSuite } from '../suites'
import { isSuccessfulResponse } from '../utils'

apiSuite('Migrations (v2 getStore)', (appState: AppState) => {
  const app = makeServer(appState)
  const agent = supertest.agent(app)

  const v2Hostnames = appState.config.migrationOriginServers.map(
    url => new URL(url).hostname
  )
  const v2Agents = v2Hostnames.map(hostname =>
    supertest.agent(`https://${hostname}`)
  )

  const repoId = appState.config.testMigrationRepo
  let repoStoreContent: GetStoreResponse

  // Fixtures:

  before(async () => {
    // Get the repo/store data from one of the V2 servers
    const responses = await Promise.all(
      v2Agents.map(v2Agent => v2Agent.get(`/api/v2/store/${repoId}`))
    )

    const successfulResponse = responses.find(res => res.status === 200)

    if (successfulResponse == null) {
      throw new Error(
        'Unable to find testMigrationRepo in any of the migrationOriginServers'
      )
    }

    repoStoreContent = successfulResponse.body
  })

  // Tests:

  it('GET /api/v2/store passive migration', async () => {
    const res = await agent
      .get(`/api/v2/store/${repoId}`)
      .expect(isSuccessfulResponse)

    expect(res.body.changes).to.deep.equal(repoStoreContent.changes)
    expect(res.body.hash != null, 'Missing hash field in response')
    expect(
      !isNaN(parseInt(res.body.hash)),
      'Hash field should be a timestamp value'
    )
  })
})
