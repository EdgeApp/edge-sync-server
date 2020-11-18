import nano from 'nano'

import config from '../config.json'
import { StoreDirectory, StoreFile, StoreRepo } from './types'

const url = `http://admin:${config.couchAdminPassword}@${config.couchHost}:${config.couchPort}`

type AllDocumentTypes = StoreRepo | StoreDirectory | StoreFile

export const dataStore = nano(url).use<AllDocumentTypes>('sync_datastore')
