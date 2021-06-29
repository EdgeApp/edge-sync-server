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

export const dataStoreDatabaseName = 'sync_datastore'

export const getDataStoreDatabaseSetup = (config: Config): DatabaseSetup => ({
  name: dataStoreDatabaseName,
  options: {
    ...config.couchSharding,
    partitioned: true
  },

  documents: {
    '_design/versioning': versioningDesign,
    '_design/conflicts': conflictsDesign
  }
})

export const getDataStoreDb = (
  couchUri: string,
  database: string = dataStoreDatabaseName
): nano.DocumentScope<StoreData> => nano(couchUri).use<StoreData>(database)
