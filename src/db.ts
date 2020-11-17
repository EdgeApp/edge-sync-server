import nano from 'nano'

import config from '../config.json'
import { StoreDirectory, StoreFile, StoreRoot } from './types'

const url = `http://admin:${config.couchAdminPassword}@${config.couchHost}:${config.couchPort}`

type AllDocumentTypes = StoreRoot | StoreDirectory | StoreFile

export const dataStore = nano(url).use<AllDocumentTypes>('sync_datastore')
