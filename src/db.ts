import nano from 'nano'

import { config } from './config'
import { StoreData } from './types'
import { CouchDbInfo } from './util/couch'

export const couchUri = `http://admin:${config.couchAdminPassword}@${config.couchHost}:${config.couchPort}`

export let dataStore: nano.DocumentScope<StoreData>

export function initDataStore(couchDatabase): void {
  dataStore = nano(couchUri).use<StoreData>(couchDatabase)
}

export const couchSchema: CouchDbInfo = {
  name: config.couchDatabase,
  sharding: config.couchSharding,
  partitioned: true
}
