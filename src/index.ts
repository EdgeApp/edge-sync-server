import cluster from 'cluster'
import { setupDatabase } from 'edge-server-tools'
import nano from 'nano'
import { cpus } from 'os'

import { config } from './config'
import { getSettingsDatabaseSetup, getSettingsDb } from './db/settings-db'
import { getStoreDatabaseSetup, getStoreDb } from './db/store-db'
import { logger } from './logger'
import { AppState, makeServer } from './server'
import { makeWsServer } from './ws-server'

const numCPUs = cpus().length

const databases = [getStoreDatabaseSetup(config), getSettingsDatabaseSetup()]

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
  const storeDb = getStoreDb(config.couchUri)
  const settingsDb = getSettingsDb(config.couchUri)
  const appState: AppState = { config, storeDb, settingsDb, dbServer }
  const app = makeServer(appState)

  // Instantiate HTTP server
  const server = app.listen(config.httpPort, () => {
    logger.info(`HTTP server started listening on ${config.httpPort}.`)
  })

  // Instantiate WebSocket server
  const wss = makeWsServer(server, appState)

  wss.on('listening', () => {
    logger.info(`WebSocket server started.`)
  })
}

function failStartup(err: any): void {
  logger.error(err)
  process.exit(1)
}
