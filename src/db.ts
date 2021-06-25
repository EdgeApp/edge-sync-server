import { DatabaseSetup } from 'edge-server-tools'
import nano from 'nano'

import { Config } from './config'
import { StoreData } from './types'

export const getCouchSetup = (config: Config): DatabaseSetup => ({
  name: config.couchDatabase,
  options: {
    ...config.couchSharding,
    partitioned: true
  }
})

export const getDbServer = (config: Config): nano.ServerScope =>
  nano(config.couchUri)

export const getDataStore = (config: Config): nano.DocumentScope<StoreData> =>
  getDbServer(config).use<StoreData>(config.couchDatabase)
