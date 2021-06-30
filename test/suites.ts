import { DatabaseSetup, setupDatabase } from 'edge-server-tools'
import nano from 'nano'

import { config } from '../src/config'
import { getSettingsDatabaseSetup, getSettingsDb } from '../src/db/settings-db'
import { getStoreDatabaseSetup, getStoreDb } from '../src/db/store-db'
import { AppState } from '../src/server'

const addRandomSuffix = (setup: DatabaseSetup): DatabaseSetup => ({
  ...setup,
  name: `${setup.name}_${Math.random().toString().replace('.', '')}`
})

export const apiSuite = (
  name: string,
  test: (appState: AppState) => void
): void => {
  const storeDatabaseSetup = addRandomSuffix(getStoreDatabaseSetup(config))
  const settingsDatabaseSetup = getSettingsDatabaseSetup()

  const databases = [storeDatabaseSetup, settingsDatabaseSetup]

  const dbServer = nano(config.couchUri)
  const storeDb = getStoreDb(config.couchUri, storeDatabaseSetup.name)
  const settingsDb = getSettingsDb(config.couchUri, settingsDatabaseSetup.name)
  const appState: AppState = { config, storeDb, settingsDb, dbServer }

  describe(name, () => {
    before(async () => {
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
    })
    test(appState)
    after(async () => {
      try {
        await dbServer.db.destroy(storeDatabaseSetup.name)
        await dbServer.db.destroy(settingsDatabaseSetup.name)
      } catch (error) {
        if (error.error !== 'not_found') {
          throw error
        }
      }
    })
  })
}
