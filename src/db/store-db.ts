import {
  DatabaseSetup,
  JsDesignDocument,
  stringifyCode
} from 'edge-server-tools'
import nano from 'nano'

import { Config } from '../config'
import { StoreData } from '../types/store-types'

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
      // Use the value property on the view document to contain all the
      // document revs that are conflicting with each other.
      map: stringifyCode(function (doc) {
        if (doc._conflicts != null) {
          emit(null, [doc._rev, ...doc._conflicts])
        }
      })
    }
  },
  options: {
    partitioned: true
  }
}

export const storeDatabaseName = 'sync_store'

export const getStoreDatabaseSetup = (config: Config): DatabaseSetup => ({
  name: storeDatabaseName,
  options: {
    ...config.couchSharding,
    partitioned: true
  },

  documents: {
    '_design/versioning': versioningDesign,
    '_design/conflicts': conflictsDesign
  }
})

export const getStoreDb = (
  couchUri: string,
  database: string = storeDatabaseName
): nano.DocumentScope<StoreData> => nano(couchUri).use<StoreData>(database)
