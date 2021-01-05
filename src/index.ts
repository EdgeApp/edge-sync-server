import { config } from './config'
import { getCouchSchema, getCouchUri, getDataStore } from './db'
import { makeServer } from './server'
import { initStoreSettings } from './storeSettings'
import { setupCouchDatabase } from './util/couch'

const couchUri = getCouchUri(config)
const couchSchema = getCouchSchema(config)

setupCouchDatabase(couchUri, [couchSchema])
  .then((): void => {
    const dataStore = getDataStore(config)
    const app = makeServer({ config, dataStore })

    // Instantiate server
    app.listen(config.httpPort, () => {
      console.log('Server is listening on:', config.httpPort)

      // Initialize store settings
      initStoreSettings(config).catch(failStartup)
    })
  })
  .catch(failStartup)

function failStartup(err: any): void {
  console.error(err)
  process.exit(1)
}
