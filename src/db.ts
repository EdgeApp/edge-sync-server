import nano from 'nano'

import { config } from './config'
import { StoreDocument } from './types'

const url = `http://admin:${config.couchAdminPassword}@${config.couchHost}:${config.couchPort}`

const database =
  typeof process.env.DATABASE === 'string'
    ? process.env.DATABASE
    : 'sync_datastore'

const connection = nano(url)
const dataStore = connection.use<StoreDocument>(database)

export { connection as nano, dataStore }
