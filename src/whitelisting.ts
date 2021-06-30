import { NextFunction, Request, Response } from 'express'

import { AppState } from './server'
import { getStoreSettings } from './storeSettings'
import { ServerError } from './types/primitive-types'
import { StoreSettings } from './types/store-types'

// Middleware:

export const whitelistIps = (appState: AppState) => async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  const storeSettings = await getStoreSettings(appState.config)
  const clientIp = req.ip

  if (!passWhitelistIps(storeSettings, clientIp)) {
    throw new ServerError(403, 'Forbidden IP')
  }

  next()
}

export const whitelistApiKeys = (appState: AppState) => async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  const storeSettings = await getStoreSettings(appState.config)
  const clientApiKey = req.query.apiKey

  if (!passWhitelistApiKeys(storeSettings, clientApiKey)) {
    throw new ServerError(403, 'Forbidden API Key')
  }

  next()
}

export const whitelistAll = (appState: AppState) => async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  const storeSettings = await getStoreSettings(appState.config)
  const clientIp = req.ip
  const clientApiKey = req.query.apiKey

  if (
    passWhitelistIps(storeSettings, clientIp) ||
    passWhitelistApiKeys(storeSettings, clientApiKey)
  ) {
    return next()
  } else {
    throw new ServerError(403, 'Forbidden IP or API Key')
  }
}

// Unit Functions:

export const passWhitelistIps = (
  storeSettings: StoreSettings,
  clientIp: string
): boolean => {
  const { ipWhitelist } = storeSettings

  return Object.keys(ipWhitelist).length === 0 || ipWhitelist[clientIp]
}

export const passWhitelistApiKeys = (
  storeSettings: StoreSettings,
  clientApiKey: string
): boolean => {
  const { apiKeyWhitelist } = storeSettings

  return (
    Object.keys(apiKeyWhitelist).length === 0 || apiKeyWhitelist[clientApiKey]
  )
}
