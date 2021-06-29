import { DatabaseSetup } from 'edge-server-tools'
import nano from 'nano'

import { SettingsData, StoreSettings } from '../types/settings-types'

export const defaultStoreSettings: StoreSettings = {
  ipWhitelist: {},
  apiKeyWhitelist: {}
}
export const settingsDocumentKey = 'store_settings'

export const settingsDatabaseName = 'sync_settings'

export const getSettingsDatabaseSetup = (): DatabaseSetup => ({
  name: settingsDatabaseName,
  templates: {
    [settingsDocumentKey]: defaultStoreSettings
  }
})

export const getSettingsDb = (
  couchUri: string,
  database: string = settingsDatabaseName
): nano.DocumentScope<SettingsData> =>
  nano(couchUri).use<SettingsData>(database)
