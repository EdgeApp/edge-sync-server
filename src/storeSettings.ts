import { Config } from './config'
import { getDataStore } from './db'
import { asStoreSettings, StoreSettings } from './types/store-types'

export const settingsDocumentKey =
  '00000000000000000000000000000000000000000_:settings'

export const defaultStoreSettings: StoreSettings = {
  ipWhitelist: {},
  apiKeyWhitelist: {}
}

// TTL set to an hour
const cacheTTL: number = 1000 * 60 * 60

let cachedStoreSettings: StoreSettings
let cacheTimestamp: number = 0

export const getStoreSettings = async (
  config: Config
): Promise<StoreSettings> => {
  const dataStore = getDataStore(config)
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
    throw new Error(
      `Failed to load settings document. ${JSON.stringify(error.message)}`
    )
  }
}

export const initStoreSettings = async (config: Config): Promise<void> => {
  const dataStore = getDataStore(config)
  try {
    const doc = await dataStore.get(settingsDocumentKey)
    asStoreSettings(doc)
  } catch (error) {
    if (error.error !== 'not_found') {
      throw new Error(
        `Failed to load settings document. ${JSON.stringify(error.message)}`
      )
    }

    await dataStore.insert(defaultStoreSettings, settingsDocumentKey)
  }
}
