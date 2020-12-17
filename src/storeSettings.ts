import { dataStore } from './db'
import { asStoreSettings, StoreSettings } from './types'

export const settingsDocumentKey =
  '00000000000000000000000000000000000000000_:settings'

// TTL set to an hour
const cacheTTL: number = 1000 * 60 * 60

let cachedStoreSettings: StoreSettings
let cacheTimestamp: number = 0

export async function getStoreSettings(): Promise<StoreSettings> {
  const currentTimestamp = Date.now()
  try {
    if (
      cachedStoreSettings === undefined ||
      currentTimestamp - cacheTimestamp > cacheTTL
    ) {
      const doc = await dataStore.get(settingsDocumentKey)
      cachedStoreSettings = asStoreSettings(doc)
      cacheTimestamp = currentTimestamp
    }
    return cachedStoreSettings
  } catch (error) {
    throw new Error(`Failed to load settings document. ${error.message}`)
  }
}

export async function initStoreSettings(): Promise<void> {
  let storeSettings: StoreSettings
  try {
    const doc = await dataStore.get(settingsDocumentKey)
    storeSettings = asStoreSettings(doc)
  } catch (error) {
    if (error.error !== 'not_found') {
      throw new Error(`Failed to load settings document. ${error.message}`)
    }

    storeSettings = {
      ipWhitelist: {},
      apiKeyWhitelist: {}
    }
    await dataStore.insert(storeSettings, settingsDocumentKey)
  }
}
