import nano from 'nano'

import { config } from './config'
import { StoreDirectory, StoreFile, StoreRepo } from './types'

const url = `http://admin:${config.couchAdminPassword}@${config.couchHost}:${config.couchPort}`

type AllDocumentTypes = StoreRepo | StoreDirectory | StoreFile

const database =
  typeof process.env.DATABASE === 'string'
    ? process.env.DATABASE
    : 'sync_datastore'

const connection = nano(url)
const dataStore = connection.use<AllDocumentTypes>(database)

export { connection as nano, dataStore }
