import { DatabaseSetup, setupDatabase } from 'edge-server-tools'
import e from 'express'
import { Server } from 'http'
import nano from 'nano'
import { AddressInfo } from 'net'
import supertest from 'supertest'

import { Config, config } from '../../src/config'
import {
  getSettingsDatabaseSetup,
  getSettingsDb
} from '../../src/db/settings-db'
import { getStoreDatabaseSetup, getStoreDb } from '../../src/db/store-db'
import {
  ChangeHub,
  makeChangeHub,
  makeLocalHubLink
} from '../../src/engine/changeHub'
import { makeCouchChangeSource } from '../../src/engine/changeSource'
import {
  ConnectionCounter,
  makeConnectionCounter,
  makeLocalConnectionLimiter
} from '../../src/engine/connectionLimiter'
import {
  makeRepoChangeEngine,
  RepoChangeEngine
} from '../../src/engine/repoChangeEngine'
import { AppState, makeServer } from '../../src/server'
import { Checkpoint } from '../../src/types/checkpoints'
import { getCheckpointAt } from '../../src/util/store/checkpoints'
import { makeWsServer, WS_PATH, WsServer } from '../../src/ws-server'

export interface ListeningKit {
  url: string
  wsUrl: string
  engine: RepoChangeEngine
  hub: ChangeHub
  wsServer: WsServer
  connections: ConnectionCounter
}

export interface ListenOptions {
  /** Overrides for the WebSocket and change-feed config. */
  config?: Partial<Config>
  /** Replaces the checkpoint reader used by the socket (not the engine). */
  getCheckpoint?: (repoId: string) => Promise<Checkpoint>
}

export interface AppTestKit {
  appState: AppState
  app: e.Express
  agent: supertest.SuperTest<supertest.Test>
  setup: () => Promise<void>
  cleanup: () => Promise<void>
  /**
   * Serves the app on a random port with a WebSocket server and an
   * in-process change engine reading this kit's store database.
   */
  listen: (options?: ListenOptions) => Promise<ListeningKit>
  closeServer: () => Promise<void>
}

interface AppTestKitOptions {
  settingsDatabaseSetup?: DatabaseSetup
  storeDatabaseSetup?: DatabaseSetup
}

export const makeAppTestKit = (options: AppTestKitOptions = {}): AppTestKit => {
  const {
    settingsDatabaseSetup = randomDatabaseName(getSettingsDatabaseSetup()),
    storeDatabaseSetup = randomDatabaseName(getStoreDatabaseSetup(config))
  } = options

  const databases = [storeDatabaseSetup, settingsDatabaseSetup]

  const dbServer = nano(config.couchUri)
  const storeDb = getStoreDb(config.couchUri, storeDatabaseSetup.name)
  const settingsDb = getSettingsDb(config.couchUri, settingsDatabaseSetup.name)
  const appState: AppState = { config, storeDb, settingsDb, dbServer }
  const app = makeServer(appState)
  const agent = supertest.agent(app)

  let server: Server | undefined
  let listening: ListeningKit | undefined

  return {
    appState,
    app,
    agent,
    async setup() {
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
    },
    async cleanup() {
      try {
        await dbServer.db.destroy(storeDatabaseSetup.name)
        await dbServer.db.destroy(settingsDatabaseSetup.name)
      } catch (error) {
        if (error.error !== 'not_found') {
          throw error
        }
      }
    },
    async listen(listenOptions = {}) {
      const kitConfig: Config = {
        ...config,
        changeFeedCoalesceMs: 100,
        changeFeedTimeoutMs: 2000,
        ...listenOptions.config
      }
      const httpServer = app.listen(0)
      server = httpServer
      await new Promise<void>(resolve => httpServer.on('listening', resolve))
      const { port } = httpServer.address() as AddressInfo

      // The engine delivers through the link, which needs the engine:
      const deliverTo: { link?: ReturnType<typeof makeLocalHubLink> } = {}
      const engine = makeRepoChangeEngine({
        makeSource: makeCouchChangeSource({
          couchUri: config.couchUri,
          databaseName: storeDatabaseSetup.name,
          timeoutMs: kitConfig.changeFeedTimeoutMs
        }),
        getCheckpoint: getCheckpointAt(appState),
        deliver: (_worker, updates) => deliverTo.link?.deliver(updates),
        onFatal: () => {},
        log: { info() {}, warn() {}, error() {} },
        coalesceMs: kitConfig.changeFeedCoalesceMs,
        feedTimeoutMs: kitConfig.changeFeedTimeoutMs,
        maxRestarts: kitConfig.changeFeedMaxRestarts
      })
      const link = makeLocalHubLink(engine)
      deliverTo.link = link
      const hub = makeChangeHub(link)
      engine.start()

      const connections = makeConnectionCounter(kitConfig.wsMaxConnectionsPerIp)
      const wsServer = makeWsServer(httpServer, {
        config: kitConfig,
        hub,
        getCheckpoint: listenOptions.getCheckpoint ?? getCheckpointAt(appState),
        limiter: makeLocalConnectionLimiter(connections)
      })

      listening = {
        url: `http://127.0.0.1:${port}`,
        wsUrl: `ws://127.0.0.1:${port}${WS_PATH}`,
        engine,
        hub,
        wsServer,
        connections
      }
      return listening
    },
    async closeServer() {
      if (listening != null) {
        listening.engine.stop()
        await listening.wsServer.close()
        listening = undefined
      }
      if (server != null) {
        const closing = server
        server = undefined
        await new Promise<void>(resolve => closing.close(() => resolve()))
      }
    }
  }
}

export const randomDatabaseName = (setup: DatabaseSetup): DatabaseSetup => ({
  ...setup,
  name: `${setup.name}_${Math.random().toString().replace('.', '')}`
})
