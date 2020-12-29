import nano from 'nano'

import { config } from './config'
import { StoreDocument } from './types'
import { CouchDbInfo } from './util/couch'

export const couchUri = `http://admin:${config.couchAdminPassword}@${config.couchHost}:${config.couchPort}`

export let dataStore: nano.DocumentScope<StoreDocument>

export function initDataStore(couchDatabase): void {
  dataStore = nano(couchUri).use<StoreDocument>(couchDatabase)
}

export const couchSchema: CouchDbInfo = {
  name: config.couchDatabase,
  sharding: config.couchSharding,
  partitioned: true
}
