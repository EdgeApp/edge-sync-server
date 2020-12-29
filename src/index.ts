import { config } from './config'
import { couchSchema, couchUri, initDataStore } from './db'
import { app } from './server'
import { initStoreSettings } from './storeSettings'
import { setupCouchDatabase } from './util/couch'

setupCouchDatabase(couchUri, [couchSchema])
  .then((): void => {
    initDataStore(config.couchDatabase)

    // Instantiate server
    app.listen(config.httpPort, () => {
      console.log('Server is listening on:', config.httpPort)

      // Initialize store settings
      initStoreSettings().catch(failStartup)
    })
  })
  .catch(failStartup)

function failStartup(err: any): void {
  console.error(err)
  process.exit(1)
}
