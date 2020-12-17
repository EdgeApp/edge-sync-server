import { config } from './config'
import { app } from './server'
import { initStoreSettings } from './storeSettings'

// Instantiate server
app.listen(config.httpPort, () => {
  console.log('Server is listening on:', config.httpPort)

  // Initialize store settings
  initStoreSettings().catch(err => {
    console.error(err)
    process.exit(1)
  })
})
