import {
  DatabaseSetup,
  JsDesignDocument,
  stringifyCode
} from 'edge-server-tools'
import nano from 'nano'

import { Config } from './config'
import { StoreData as OldStoreData } from './types/old-types'
import { StoreData } from './types/store-types'

declare function emit(key?: unknown, value?: unknown): void

export const getCouchSetup = (config: Config): DatabaseSetup => {
  const versioningDesign: JsDesignDocument = {
    language: 'javascript',
    views: {
      version: {
        map: stringifyCode(function (doc) {
          emit(doc.versions[0], doc.versions[0])
        }),
        reduce: '_stats'
      }
    },
    options: {
      partitioned: true
    }
  }
  const conflictsDesign: JsDesignDocument = {
    language: 'javascript',
    views: {
      conflictRevs: {
        map: stringifyCode(function (doc) {
          if (doc._conflicts != null) {
            emit()
          }
        })
      }
    },
    options: {
      partitioned: true
    }
  }

  return {
    name: config.couchDatabase,
    options: {
      ...config.couchSharding,
      partitioned: true
    },

    documents: {
      '_design/versioning': versioningDesign,
      '_design/conflicts': conflictsDesign
    }
  }
}

export const getDbServer = (config: Config): nano.ServerScope =>
  nano(config.couchUri)

export const getDataStore = (
  config: Config
): nano.DocumentScope<StoreData | OldStoreData> =>
  getDbServer(config).use<StoreData | OldStoreData>(config.couchDatabase)
