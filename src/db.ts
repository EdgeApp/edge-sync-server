import nano from 'nano'

import { Config } from './config'
import { StoreData } from './types'
import { CouchDbInfo } from './util/couch'

export const getCouchSchema = (config: Config): CouchDbInfo => ({
  name: config.couchDatabase,
  sharding: config.couchSharding,
  partitioned: true
})

export const getDbServer = (config: Config): nano.ServerScope =>
  nano(config.couchUri)

export const getDataStore = (config: Config): nano.DocumentScope<StoreData> =>
  getDbServer(config).use<StoreData>(config.couchDatabase)
