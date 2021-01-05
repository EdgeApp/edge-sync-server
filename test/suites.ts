import nano from 'nano'

import { config } from '../src/config'
import { couchUri, initDataStore } from '../src/db'
import { initStoreSettings } from '../src/storeSettings'

export const apiSuite = (name: string, test: () => void): void => {
  const databaseSuffix = Math.random()
    .toString()
    .replace('.', '')
  const database = `${config.couchDatabase}_${databaseSuffix}`

  describe(name, () => {
    before(async () => {
      try {
        await nano(couchUri).db.create(database)

        initDataStore(database)

        // Initialize store settings
        await initStoreSettings()
      } catch (error) {
        if (error.error !== 'file_exists') {
          throw error
        }
      }
    })
    test()
    after(async () => {
      try {
        await nano(couchUri).db.destroy(database)
      } catch (error) {
        if (error.error !== 'not_found') {
          throw error
        }
      }
    })
  })
}
