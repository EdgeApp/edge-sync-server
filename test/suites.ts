import nano from 'nano'

import { config as baseConfig } from '../src/config'
import { getCouchUri, getDataStore } from '../src/db'
import { AppState } from '../src/server'
import { initStoreSettings } from '../src/storeSettings'

export const apiSuite = (
  name: string,
  test: (appState: AppState) => void
): void => {
  const databaseSuffix = Math.random()
    .toString()
    .replace('.', '')

  const config = {
    ...baseConfig,
    couchDatabase: `${baseConfig.couchDatabase}_${databaseSuffix}`
  }

  const couchUri = getCouchUri(config)
  const dataStore = getDataStore(config)
  const appState: AppState = { config, dataStore }

  describe(name, () => {
    before(async () => {
      try {
        await nano(couchUri).db.create(config.couchDatabase)

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
        await nano(couchUri).db.destroy(config.couchDatabase)
      } catch (error) {
        if (error.error !== 'not_found') {
          throw error
        }
      }
    })
  })
}
