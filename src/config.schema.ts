import { asArray, asNumber, asObject, asOptional, asString } from 'cleaners'

export type Config = ReturnType<typeof asConfig>

// Config:

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

// Customization:

const {
  NODE_ENV = 'production',
  COUCH_HOSTNAME = 'localhost',
  COUCH_PASSWORD = 'password'
} = process.env

const isDev = NODE_ENV === 'dev'

// Default:

export const configTemplate: Config = {
  couchDatabase: 'sync_datastore',
  couchUri: 'http://admin:{password}@{hostname}:5984',
  couchHostname: COUCH_HOSTNAME,
  couchPassword: COUCH_PASSWORD,
  couchSharding: {
    q: 16,
    n: 3
  },
  httpPort: 8008,
  maxTimestampHistoryAge: 2592000000,
  maxPageSize: 100,
  instanceCount: isDev ? 4 : undefined,
  migrationOriginServers: [
    'https://git-uk.edge.app/repos/',
    'https://git3.airbitz.co/repos/',
    'https://git-eusa.edge.app/repos/'
  ],
  migrationTmpDir: '/tmp/app/edge-sync-server/',
  testMigrationRepo: '000000000000000000000000000000000ed9e123'
}
