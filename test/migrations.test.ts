import { expect } from 'chai'
import { it } from 'mocha'
import supertest from 'supertest'

import { AppState, makeServer } from '../src/server'
import {
  GetFilesResponse,
  GetStoreResponse,
  GetUpdatesResponse
} from '../src/types'
import { apiSuite } from './suites'
import { isSuccessfulResponse } from './utils'

apiSuite('Migrations (v3 getFiles)', (appState: AppState) => {
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
  const paths: { [path: string]: number } = {}

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

    Object.keys(repoStoreContent.changes).forEach(key => {
      // Add leading forward-slash
      paths[`/${key}`] = 0
    })
  })

  // Tests:

  it('GET /api/v3/getFiles passive migration', async () => {
    const res = await agent
      .post('/api/v3/getFiles')
      .send({
        repoId,
        ignoreTimestamps: true,
        paths
      })
      .expect(res => isSuccessfulResponse(res))

    const data: GetFilesResponse = res.body.data

    for (const path in data.paths) {
      const fileData = data.paths[path]
      // Remove leading forward-slash
      const expectedFileContent = repoStoreContent.changes[path.substr(1)]

      if (!('box' in fileData)) {
        throw new Error(`Expected 'box' field in response data`)
      }

      expect(fileData.box).to.deep.equal(expectedFileContent)
      expect(
        fileData.timestamp != null,
        `Expected 'timestamp' field in response data`
      )
      expect(
        !isNaN(parseInt(fileData.timestamp)),
        `Expected 'timestamp' field to be a timestamp in response data`
      )
    }
  })
})

apiSuite('Migrations (v3 getUpdates)', (appState: AppState) => {
  const app = makeServer(appState)
  const agent = supertest.agent(app)

  const v2Hostnames = appState.config.migrationOriginServers.map(
    url => new URL(url).hostname
  )
  const v2Agents = v2Hostnames.map(hostname =>
    supertest.agent(`https://${hostname}`)
  )

  const repoId = appState.config.testMigrationRepo
  const paths: string[] = []

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

    Object.keys(successfulResponse.body.changes).forEach(key => {
      // Add leading forward-slash
      paths.push(`/${key}`)
    })
  })

  // Tests:

  it('GET /api/v3/getUpdates passive migration', async () => {
    const res = await agent
      .post('/api/v3/getUpdates')
      .send({
        repoId,
        timestamp: 0
      })
      .expect(res => isSuccessfulResponse(res))

    const data: GetUpdatesResponse = res.body.data

    expect(Object.keys(data.paths)).to.have.members(paths)
    expect(data.deleted).deep.equal({})
  })
})
