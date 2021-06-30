import { setupDatabase } from 'edge-server-tools'

import { config as baseConfig } from '../src/config'
import { getCouchSetup, getDataStore, getDbServer } from '../src/db'
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
        // Setup databases
        await setupDatabase(config.couchUri, getCouchSetup(config), {
          log: () => {}
        })
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
