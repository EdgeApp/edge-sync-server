import cluster from 'cluster'
import { cpus } from 'os'

import { config } from './config'
import { getCouchSchema, getCouchUri, getDataStore, getDbServer } from './db'
import { logger } from './logger'
import { makeServer } from './server'
import { initStoreSettings } from './storeSettings'
import { setupCouchDatabase } from './util/couch'

const numCPUs = cpus().length
const couchUri = getCouchUri(config)
const couchSchema = getCouchSchema(config)

if (cluster.isMaster) {
  setupCouchDatabase(couchUri, [couchSchema])
    .then(() =>
      // Initialize store settings
      initStoreSettings(config)
    )
    .then(() => {
      const instanceCount = config.instanceCount ?? numCPUs

      // Fork workers.
      for (let i = 0; i < instanceCount; i++) {
        cluster.fork()
      }

      // Restart workers when they exit
      cluster.on('exit', (worker, code, signal) => {
        logger.info(
          `Worker ${worker.process.pid} died with code ${code} and signal ${signal}`
        )
        logger.info(`Forking new worker process...`)
        cluster.fork()
      })
    })
    .catch(failStartup)
} else {
  const dbServer = getDbServer(config)
  const dataStore = getDataStore(config)
  const app = makeServer({ config, dataStore, dbServer })

  // Instantiate server
  app.listen(config.httpPort, () => {
    logger.info(
      `Worker process ${process.pid} started and listening on ${config.httpPort}.`
    )
  })
}

function failStartup(err: any): void {
  logger.error(err)
  process.exit(1)
}
