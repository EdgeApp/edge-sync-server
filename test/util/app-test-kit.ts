import { DatabaseSetup, setupDatabase } from 'edge-server-tools'
import e from 'express'
import nano from 'nano'
import supertest from 'supertest'

import { config } from '../../src/config'
import {
  getSettingsDatabaseSetup,
  getSettingsDb
} from '../../src/db/settings-db'
import { getStoreDatabaseSetup, getStoreDb } from '../../src/db/store-db'
import { AppState, makeServer } from '../../src/server'

export interface AppTestKit {
  appState: AppState
  app: e.Express
  agent: supertest.SuperTest<supertest.Test>
  setup: () => Promise<void>
  cleanup: () => Promise<void>
}

interface AppTestKitOptions {
  settingsDatabaseSetup?: DatabaseSetup
  storeDatabaseSetup?: DatabaseSetup
}

export const makeAppTestKit = (options: AppTestKitOptions = {}): AppTestKit => {
  const {
    settingsDatabaseSetup = randomDatabaseName(getSettingsDatabaseSetup()),
    storeDatabaseSetup = randomDatabaseName(getStoreDatabaseSetup(config))
  } = options

  const databases = [storeDatabaseSetup, settingsDatabaseSetup]

  const dbServer = nano(config.couchUri)
  const storeDb = getStoreDb(config.couchUri, storeDatabaseSetup.name)
  const settingsDb = getSettingsDb(config.couchUri, settingsDatabaseSetup.name)
  const appState: AppState = { config, storeDb, settingsDb, dbServer }
  const app = makeServer(appState)
  const agent = supertest.agent(app)

  return {
    appState,
    app,
    agent,
    async setup() {
      try {
        // Setup databases
        await Promise.all(
          databases.map(
            async setup =>
              await setupDatabase(config.couchUri, setup, {
                log: () => {}
              })
          )
        )
      } catch (error) {
        if (error.error !== 'file_exists') {
          throw error
        }
      }
    },
    async cleanup() {
      try {
        await dbServer.db.destroy(storeDatabaseSetup.name)
        await dbServer.db.destroy(settingsDatabaseSetup.name)
      } catch (error) {
        if (error.error !== 'not_found') {
          throw error
        }
      }
    }
  }
}

export const randomDatabaseName = (setup: DatabaseSetup): DatabaseSetup => ({
  ...setup,
  name: `${setup.name}_${Math.random().toString().replace('.', '')}`
})
