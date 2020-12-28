import { NextFunction, Request, Response } from 'express'

import { getStoreSettings } from './storeSettings'
import { makeApiClientError } from './util/utils'

export async function whitelistIps(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const { ipWhitelist } = await getStoreSettings()

  const clientIp = req.ip

  if (Object.keys(ipWhitelist).length > 0 && !ipWhitelist[clientIp]) {
    throw makeApiClientError(403, 'Forbidden IP')
  }

  next()
}

export async function whitelistApiKeys(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const { apiKeyWhitelist } = await getStoreSettings()

  const clientApiKey = req.query.apiKey

  if (
    Object.keys(apiKeyWhitelist).length > 0 &&
    !apiKeyWhitelist[clientApiKey]
  ) {
    throw makeApiClientError(403, 'Forbidden API Key')
  }

  next()
}

export async function whitelistAll(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await whitelistIps(req, res, next)
  } catch (_error) {
    try {
      await whitelistApiKeys(req, res, next)
    } catch (error) {
      throw makeApiClientError(403, 'Forbidden IP and API Key')
    }
  }
}
