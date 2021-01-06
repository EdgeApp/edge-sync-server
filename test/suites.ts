import { config as baseConfig } from '../src/config'
import { getDataStore, getDbServer } from '../src/db'
import { AppState } from '../src/server'
import { initStoreSettings } from '../src/storeSettings'

export const apiSuite = (
  name: string,
  test: (appState: AppState) => void
): void => {
  const databaseSuffix = Math.random().toString().replace('.', '')

  const config = {
    ...baseConfig,
    couchDatabase: `${baseConfig.couchDatabase}_${databaseSuffix}`
  }

  const dbServer = getDbServer(config)
  const dataStore = getDataStore(config)
  const appState: AppState = { config, dataStore, dbServer }

  describe(name, () => {
    before(async () => {
      try {
        await dbServer.db.create(config.couchDatabase)

        // Initialize store settings
        await initStoreSettings(config)
      } catch (error) {
        if (error.error !== 'file_exists') {
          throw error
        }
      }
    })
    test(appState)
    after(async () => {
      try {
        await dbServer.db.destroy(config.couchDatabase)
      } catch (error) {
        if (error.error !== 'not_found') {
          throw error
        }
      }
    })
  })
}

export const replicationSuite = (
  name: string,
  test: (appStateA: AppState, appStateB: AppState) => void
): void => {
  const databaseSuffix = Math.random().toString().replace('.', '')

  const couchDatabase = `${baseConfig.couchDatabase}_${databaseSuffix}`

  const configA = {
    ...baseConfig,
    couchDatabase: `${couchDatabase}_a`
  }
  const appStateA: AppState = {
    config: configA,
    dataStore: getDataStore(configA),
    dbServer: getDbServer(configA)
  }

  const configB = {
    ...baseConfig,
    couchDatabase: `${couchDatabase}_b`
  }
  const appStateB: AppState = {
    config: configB,
    dataStore: getDataStore(configB),
    dbServer: getDbServer(configB)
  }

  describe(name, function () {
    this.timeout(20000)

    before(async () => {
      try {
        await appStateA.dbServer.db.create(configA.couchDatabase)
        await initStoreSettings(configA)

        await appStateB.dbServer.db.create(configB.couchDatabase)
        await initStoreSettings(configB)
      } catch (error) {
        if (error.error !== 'file_exists') {
          throw error
        }
      }
    })
    test(appStateA, appStateB)
    after(async () => {
      try {
        await appStateA.dbServer.db.destroy(configA.couchDatabase)
        await appStateB.dbServer.db.destroy(configB.couchDatabase)
      } catch (error) {
        if (error.error !== 'not_found') {
          throw error
        }
      }
    })
  })
}
