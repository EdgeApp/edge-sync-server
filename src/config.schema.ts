import { asArray, asNumber, asObject, asOptional, asString } from 'cleaners'

export type Config = ReturnType<typeof asConfig>

export const asConfig = asObject({
  // sync_datastore
  couchDatabase: asString,
  // http://admin:{password}@localhost:5984
  couchUri: asString,
  couchPassword: asString,
  // CouchDB sharding parmeters
  couchSharding: asObject({
    // Number of shards (24)
    q: asNumber,
    // Number of shard replicas (1)
    n: asNumber
  }),
  httpPort: asNumber, // 8000
  maxTimestampHistoryAge: asNumber,
  maxPageSize: asNumber, // 100
  // Number of processes to fork in the cluster (defaults to number of CPU cores)
  instanceCount: asOptional(asNumber),
  // URL of the servers from which to migrate repos.
  migrationOriginServers: asArray(asString),
  // Temp directory to use for repo migrations
  migrationTmpDir: asString,
  testMigrationRepo: asString
})

export const configSample: Config = {
  couchDatabase: 'sync_datastore',
  couchUri: 'http://admin:{password}@localhost:5984',
  couchPassword: 'password123',
  couchSharding: {
    q: 24,
    n: 1
  },
  httpPort: 8008,
  maxTimestampHistoryAge: 2592000000,
  maxPageSize: 100,
  instanceCount: 4,
  migrationOriginServers: [
    'https://git-uk.edge.app/repos/',
    'https://git3.airbitz.co/repos/',
    'https://git-eusa.edge.app/repos/'
  ],
  migrationTmpDir: '/tmp/app/edge-sync-server/',
  testMigrationRepo: '000000000000000000000000000000000ed9e123'
}
