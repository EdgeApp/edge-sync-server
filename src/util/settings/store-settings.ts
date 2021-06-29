import { settingsDocumentKey } from '../../db/settings-db'
import { AppState } from '../../server'
import { asStoreSettings, StoreSettings } from '../../types/settings-types'

// TTL set to an hour
const cacheTTL: number = 1000 * 60 * 60

let cachedStoreSettings: StoreSettings
let cacheTimestamp: number = 0

export const getStoreSettings = async (
  appState: AppState
): Promise<StoreSettings> => {
  const currentTimestamp = Date.now()
  try {
    if (
      cachedStoreSettings === undefined ||
      currentTimestamp - cacheTimestamp > cacheTTL
    ) {
      const doc = await appState.settingsDb.get(settingsDocumentKey)
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
