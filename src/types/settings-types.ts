import { asBoolean, asObject } from 'cleaners'

// Settings Document

export type StoreSettings = ReturnType<typeof asStoreSettings>
export const asStoreSettings = asObject({
  ipWhitelist: asObject(asBoolean),
  apiKeyWhitelist: asObject(asBoolean)
})

export type SettingsData = StoreSettings
