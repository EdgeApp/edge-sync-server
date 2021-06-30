import { DatabaseSetup } from 'edge-server-tools'
import nano from 'nano'

import { AccessSettings, SettingsData } from '../types/settings-types'

export const defaultAccessSettings: AccessSettings = {
  ipWhitelist: {},
  apiKeyWhitelist: {}
}
export const accessSettingsDocumentKey = 'access_settings'

export const settingsDatabaseName = 'sync_settings'

export const getSettingsDatabaseSetup = (): DatabaseSetup => ({
  name: settingsDatabaseName,
  templates: {
    [accessSettingsDocumentKey]: defaultAccessSettings
  }
})

export const getSettingsDb = (
  couchUri: string,
  database: string = settingsDatabaseName
): nano.DocumentScope<SettingsData> =>
  nano(couchUri).use<SettingsData>(database)
