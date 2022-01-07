import { NextFunction, Request, Response } from 'express'

import { AppState } from './server'
import { AccessSettings } from './types/settings-types'
import { ServerError } from './util/server-error'
import { getAccessSettings } from './util/settings/store-settings'

// Middleware:

export const whitelistIps = (appState: AppState) => async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  const accessSettings = await getAccessSettings(appState)
  const clientIp = req.ip

  if (!passWhitelistIps(accessSettings, clientIp)) {
    throw new ServerError(403, 'Forbidden IP')
  }

  next()
}

export const whitelistApiKeys = (appState: AppState) => async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  const accessSettings = await getAccessSettings(appState)
  const xApiKeyHeader = req.headers['x-api-key']
  const clientApiKey =
    xApiKeyHeader != null
      ? Array.isArray(xApiKeyHeader)
        ? xApiKeyHeader[0]
        : xApiKeyHeader
      : ''

  if (!passWhitelistApiKeys(accessSettings, clientApiKey)) {
    throw new ServerError(403, 'Forbidden API Key')
  }

  next()
}

export const whitelistAll = (appState: AppState) => async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  const accessSettings = await getAccessSettings(appState)
  const clientIp = req.ip
  const clientApiKey = req.query.apiKey

  if (
    passWhitelistIps(accessSettings, clientIp) ||
    passWhitelistApiKeys(accessSettings, clientApiKey)
  ) {
    return next()
  } else {
    throw new ServerError(403, 'Forbidden IP or API Key')
  }
}

// Unit Functions:

export const passWhitelistIps = (
  accessSettings: AccessSettings,
  clientIp: string
): boolean => {
  const { ipWhitelist } = accessSettings

  return Object.keys(ipWhitelist).length === 0 || ipWhitelist[clientIp]
}

export const passWhitelistApiKeys = (
  accessSettings: AccessSettings,
  clientApiKey: string
): boolean => {
  const { apiKeyWhitelist } = accessSettings

  return (
    Object.keys(apiKeyWhitelist).length === 0 || apiKeyWhitelist[clientApiKey]
  )
}
