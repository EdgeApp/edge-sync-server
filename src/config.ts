import { makeConfig } from 'cleaner-config'
import { asNumber, asObject, asOptional, asString } from 'cleaners'

// Customization:

const {
  NODE_ENV = 'production',
  COUCH_USERNAME = 'admin',
  COUCH_PASSWORD = 'password',
  COUCH_HOSTNAME = 'localhost',
  COUCH_PORT = '5984',
  COUCH_DB_Q = '4',
  COUCH_DB_N = '3'
} = process.env

const isDev = NODE_ENV === 'dev'

// Config:

export type Config = ReturnType<typeof asConfig>

export const asConfig = asObject({
  couchUri: asOptional(
    asString,
    `http://${COUCH_USERNAME}:${COUCH_PASSWORD}@${COUCH_HOSTNAME}:${COUCH_PORT}`
  ),
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
  instanceCount: asOptional(asNumber, isDev ? 4 : undefined),
  maxTimestampHistoryAge: asOptional(asNumber, 2592000000),
  maxPageSize: asOptional(asNumber, 100)
})

export const config = makeConfig(asConfig, process.env.CONFIG)
