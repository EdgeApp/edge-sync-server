import { NextFunction, Request, Response } from 'express'

import { AppState } from './server'
import { getStoreSettings } from './storeSettings'
import { ApiClientError } from './types'
import { makeApiClientError } from './util/utils'

export const whitelistIps = (appState: AppState) => async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  const { ipWhitelist } = await getStoreSettings(appState.config)

  const clientIp = req.ip

  if (Object.keys(ipWhitelist).length > 0 && !ipWhitelist[clientIp]) {
    throw makeApiClientError(403, 'Forbidden IP')
  }

  next()
}

export const whitelistApiKeys = (appState: AppState) => async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  const { apiKeyWhitelist } = await getStoreSettings(appState.config)

  const clientApiKey = req.query.apiKey

  if (
    Object.keys(apiKeyWhitelist).length > 0 &&
    !apiKeyWhitelist[clientApiKey]
  ) {
    throw makeApiClientError(403, 'Forbidden API Key')
  }

  next()
}

export const whitelistAll = (appState: AppState) => async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    await whitelistIps(appState)(req, res, next)
  } catch (ipError) {
    if (!(ipError instanceof ApiClientError)) throw ipError

    try {
      await whitelistApiKeys(appState)(req, res, next)
    } catch (apiKeyError) {
      if (!(apiKeyError instanceof ApiClientError)) throw apiKeyError

      throw makeApiClientError(403, 'Forbidden IP and API Key')
    }
  }
}
