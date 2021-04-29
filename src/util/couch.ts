import nano from 'nano'

import { logger } from '../logger'

/**
 * Describes a single database that should exist.
 */
export interface CouchDbInfo {
  name: string
  sharding?: {
    q: number
    n: number
  }
  partitioned?: boolean
  indexes?: Array<{
    index: {
      fields: string[]
      partial_filter_selector?: any
    }
    ddoc: string
    name: string
    type: 'json'
  }>
  views?: Array<{
    name: string
    views: {
      [viewName: string]: {
        map?: string
        reduce?: string
      }
    }
  }>
}

/**
 * Helper for turning view code into strings.
 */
export function stringifyCode(code: (...args: any[]) => void): string {
  return code.toString().replace(/ +/g, ' ')
}

/**
 * Ensures that the requested databases exist in Couch.
 */
export async function setupCouchDatabase(
  couchUri: string,
  dbs: CouchDbInfo[]
): Promise<void> {
  const nanoDb = nano(couchUri)

  // get a list of all databases within couchdb
  const result = await nanoDb.db.list()

  // if database does not exist, create it
  for (const db of dbs) {
    if (!result.includes(db.name)) {
      const { partitioned } = db
      const { q, n } = db.sharding ?? {}
      await nanoDb.request({
        method: 'put',
        db: db.name,
        qs: { q, n, partitioned }
      })
      logger.info({
        msg:
          `Created Database ${db.name}` +
          (q != null && n != null ? ` with params q=${q} n=${n}` : '')
      })
    }
    // create indexes/views
    const currentDb: nano.DocumentScope<any> = nanoDb.db.use(db.name)
    if (db.indexes != null) {
      for (const dbIndex of db.indexes) {
        try {
          await currentDb.get(`_design/${dbIndex.ddoc}`)
          logger.info(`${db.name} already has '${dbIndex.name}' index.`)
        } catch {
          await currentDb.createIndex(dbIndex)
          logger.info(`Created '${dbIndex.name}' index for ${db.name}.`)
        }
      }
    }
    if (db.views != null) {
      for (const dbView of db.views) {
        try {
          await currentDb.get(`_design/${dbView.name}`)
          logger.info(`${db.name} already has '${dbView.name}' view.`)
        } catch {
          await currentDb.insert({
            _id: `_design/${dbView.name}`,
            views: dbView.views
          })
          logger.info(`Created '${dbView.name}' view for ${db.name}.`)
        }
      }
    }
  }
  logger.info('Finished Database Setup.')
}
