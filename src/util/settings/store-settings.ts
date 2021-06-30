import { accessSettingsDocumentKey } from '../../db/settings-db'
import { AppState } from '../../server'
import { AccessSettings, asAccessSettings } from '../../types/settings-types'

// TTL set to an hour
const cacheTTL: number = 1000 * 60 * 60

let cachedAccessSettings: AccessSettings
let cacheTimestamp: number = 0

export const getAccessSettings = async (
  appState: AppState
): Promise<AccessSettings> => {
  const currentTimestamp = Date.now()
  try {
    if (
      cachedAccessSettings === undefined ||
      currentTimestamp - cacheTimestamp > cacheTTL
    ) {
      const doc = await appState.settingsDb.get(accessSettingsDocumentKey)
      cachedAccessSettings = asAccessSettings(doc)
      cacheTimestamp = currentTimestamp
    }
    return cachedAccessSettings
  } catch (error) {
    throw new Error(
      `Failed to load settings document. ${JSON.stringify(error.message)}`
    )
  }
}
