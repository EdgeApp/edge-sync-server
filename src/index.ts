import cluster from 'cluster'
import { setupDatabase } from 'edge-server-tools'
import nano from 'nano'
import { cpus } from 'os'

import { config } from './config'
import { getDataStoreDatabaseSetup, getDataStoreDb } from './db/datastore-db'
import { getSettingsDatabaseSetup, getSettingsDb } from './db/settings-db'
import { logger } from './logger'
import { makeServer } from './server'

const numCPUs = cpus().length

const databases = [
  getDataStoreDatabaseSetup(config),
  getSettingsDatabaseSetup()
]

if (cluster.isMaster) {
  Promise.all(
    databases.map(
      async setup =>
        await setupDatabase(config.couchUri, setup, {
          log: logger.info.bind(logger)
        })
    )
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
  const dbServer = nano(config.couchUri)
  const dataStore = getDataStoreDb(config.couchUri)
  const settingsDb = getSettingsDb(config.couchUri)
  const app = makeServer({ config, dataStore, settingsDb, dbServer })

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
