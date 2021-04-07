import nano from 'nano'

import { Config } from './config.schema'
import { StoreData } from './types'
import { CouchDbInfo } from './util/couch'

export const getCouchSchema = (config: Config): CouchDbInfo => ({
  name: config.couchDatabase,
  sharding: config.couchSharding,
  partitioned: true
})

export const getCouchUri = (config: Config): string =>
  config.couchUri
    .replace('{hostname}', config.couchHostname)
    .replace('{password}', config.couchPassword)

export const getDbServer = (config: Config): nano.ServerScope =>
  nano(getCouchUri(config))

export const getDataStore = (config: Config): nano.DocumentScope<StoreData> =>
  getDbServer(config).use<StoreData>(config.couchDatabase)
