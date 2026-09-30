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
  maxPageSize: asOptional(asNumber, 100),
  storeDatabaseName: asOptional(asString, 'sync_store'),

  // Repo change feed (hosted by the cluster master):
  /** Longpoll timeout for each `_changes` request. */
  changeFeedTimeoutMs: asOptional(asNumber, 60000),
  /** How long changes to one repo are merged before its checkpoint is read. */
  changeFeedCoalesceMs: asOptional(asNumber, 500),
  /** Watchdog restarts without a completed poll before the master exits. */
  changeFeedMaxRestarts: asOptional(asNumber, 10),

  // WebSocket limits:
  wsMaxConnectionsPerIp: asOptional(asNumber, 20),
  wsMaxPayload: asOptional(asNumber, 64 * 1024),
  wsMaxReposPerSubscribe: asOptional(asNumber, 100),
  wsMaxSubscriptionsPerConnection: asOptional(asNumber, 200),
  wsSubscribeCallsPerMinute: asOptional(asNumber, 10),
  wsPingIntervalMs: asOptional(asNumber, 30000),
  /** Checkpoint reads each worker runs at once while answering subscribes. */
  wsCheckpointConcurrency: asOptional(asNumber, 32)
})

export const config = makeConfig(asConfig, process.env.CONFIG)
