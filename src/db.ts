import nano from 'nano'
import config from '../config.json'

const url = `http://admin:${config.couchAdminPassword}@${config.couchHost}:${config.couchPort}`

export const dataStore = nano(url).db.use('datastore')
