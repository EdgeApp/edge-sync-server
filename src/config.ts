import { makeConfig } from 'cleaner-config'
import { asArray, asNumber, asObject, asOptional, asString } from 'cleaners'

// Customization:

const {
  NODE_ENV = 'production',
  COUCH_HOSTNAME = 'localhost',
  COUCH_PASSWORD = 'password',
  COUCH_DB_Q = '4',
  COUCH_DB_N = '3'
} = process.env

const isDev = NODE_ENV === 'dev'

// Config:

export type Config = ReturnType<typeof asConfig>

export const asConfig = asObject({
  couchDatabase: asOptional(asString, 'sync_datastore'),
  couchUri: asOptional(asString, 'http://admin:{password}@{hostname}:5984'),
  couchHostname: asOptional(asString, COUCH_HOSTNAME),
  couchPassword: asOptional(asString, COUCH_PASSWORD),
  couchSharding: asOptional(
    asObject({
      q: asNumber,
      n: asNumber
    }),
    {
      q: parseInt(COUCH_DB_Q),
      n: parseInt(COUCH_DB_N)
    }
  ),
  httpPort: asOptional(asNumber, 8008),
  maxTimestampHistoryAge: asOptional(asNumber, 2592000000),
  maxPageSize: asOptional(asNumber, 100),
  instanceCount: asOptional(asNumber, isDev ? 4 : undefined),
  migrationOriginServers: asOptional(asArray(asString), [
    'https://git-uk.edge.app/repos/',
    'https://git3.airbitz.co/repos/',
    'https://git-eusa.edge.app/repos/'
  ]),
  migrationTmpDir: asOptional(asString, '/tmp/app/edge-sync-server/'),
  testMigrationSyncKey: asOptional(
    asString,
    '000000000000000000000000000000000ed9e123'
  )
})

export const config = makeConfig(asConfig, process.env.CONFIG)
