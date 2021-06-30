import { asBoolean, asObject } from 'cleaners'

// Settings Document

export type AccessSettings = ReturnType<typeof asAccessSettings>
export const asAccessSettings = asObject({
  ipWhitelist: asObject(asBoolean),
  apiKeyWhitelist: asObject(asBoolean)
})

export type SettingsData = AccessSettings
