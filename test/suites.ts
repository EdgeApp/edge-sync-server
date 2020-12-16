import { config } from '../src/config'
import { dataStore, nano } from '../src/db'
import { settingsDocumentKey } from '../src/storeSettings'
import { StoreSettings } from '../src/types'

export const apiSuite = (name: string, test: () => void): void => {
  describe(name, () => {
    before(async () => {
      try {
        await nano.db.create(config.couchDatabase)

        const storeSettings: StoreSettings = {
          ipWhitelist: {},
          apiKeyWhitelist: {}
        }

        await dataStore.insert(storeSettings, settingsDocumentKey)
      } catch (error) {
        if (error.error !== 'file_exists') {
          throw error
        }
      }
    })
    test()
    after(async () => {
      try {
        await nano.db.destroy(config.couchDatabase)
      } catch (error) {
        if (error.error !== 'not_found') {
          throw error
        }
      }
    })
  })
}
