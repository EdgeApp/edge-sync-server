import nano from 'nano'

import { config } from './config'
import { StoreDocument } from './types'

const url = `http://admin:${config.couchAdminPassword}@${config.couchHost}:${config.couchPort}`

const connection = nano(url)
const dataStore = connection.use<StoreDocument>(config.couchDatabase)

export { connection as nano, dataStore }
