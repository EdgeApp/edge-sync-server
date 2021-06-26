import { DatabaseSetup } from 'edge-server-tools'
import nano from 'nano'

import { Config } from './config'
import { StoreData as OldStoreData } from './types/old-types'
import { StoreData } from './types/store-types'

export const getCouchSetup = (config: Config): DatabaseSetup => ({
  name: config.couchDatabase,
  options: {
    ...config.couchSharding,
    partitioned: true
  }
})

export const getDbServer = (config: Config): nano.ServerScope =>
  nano(config.couchUri)

export const getDataStore = (
  config: Config
): nano.DocumentScope<StoreData | OldStoreData> =>
  getDbServer(config).use<StoreData | OldStoreData>(config.couchDatabase)
