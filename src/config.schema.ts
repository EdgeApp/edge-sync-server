import { asNumber, asObject, asString } from 'cleaners'

export type Config = ReturnType<typeof asConfig>

export const asConfig = asObject({
  // sync_datastore
  couchDatabase: asString,
  couchAdminPassword: asString,
  // localhost
  couchHost: asString,
  // 5984
  couchPort: asString,
  // CouchDB sharding parmeters
  couchSharding: asObject({
    // Number of shards (24)
    q: asNumber,
    // Number of shard replicas (1)
    n: asNumber
  }),
  httpPort: asNumber, // 8000
  maxPageSize: asNumber, // 100
  // Git URL of the server from which to migrate repos.
  migrationOriginServer: asString,
  // Temp directory to use for repo migrations
  migrationTmpDir: asString
})
