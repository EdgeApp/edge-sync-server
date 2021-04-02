import { asArray, asNumber, asObject, asOptional, asString } from 'cleaners'

export type Config = ReturnType<typeof asConfig>

export const asConfig = asObject({
  couchDatabase: asString,
  couchUri: asString,
  couchHostname: asString,
  couchPassword: asString,
  couchSharding: asObject({
    q: asNumber,
    n: asNumber
  }),
  httpPort: asNumber,
  maxTimestampHistoryAge: asNumber,
  maxPageSize: asNumber,
  instanceCount: asOptional(asNumber),
  migrationOriginServers: asArray(asString),
  migrationTmpDir: asString,
  testMigrationRepo: asString
})

export const configSample: Config = {
  couchDatabase: 'sync_datastore',
  couchUri: 'http://admin:{password}@{hostname}:5984',
  couchHostname: 'localhost',
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
