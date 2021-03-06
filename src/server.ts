import bodyParser from 'body-parser'
import cors from 'cors'
import express, { Express, NextFunction, Request, Response } from 'express'
import nano from 'nano'

import { Config } from './config'
import { logger } from './logger'
import { ServerError, ServerErrorResponse } from './types/primitive-types'
import { SettingsData } from './types/settings-types'
import { StoreData } from './types/store-types'
import { makeRouter as makeV2Router } from './v2/routes/router'

export interface AppState {
  config: Config
  storeDb: nano.DocumentScope<StoreData>
  settingsDb: nano.DocumentScope<SettingsData>
  dbServer: nano.ServerScope
}

export function makeServer(appState: AppState): Express {
  const app = express()

  // Settings
  app.set('trust proxy', 'loopback')

  // Middleware
  app.use(bodyParser.json({ limit: '1mb' }))
  app.use(cors())
  app.use('/', express.static('dist'))

  // Routes
  app.use('/api/v2', makeV2Router(appState))

  // 404 Error Route
  app.use((_req, _res, next) => {
    next(new ServerError(404, 'not found'))
  })

  // Client Error Route
  app.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
    if (!(err instanceof ServerError)) {
      return next(err)
    }

    const response: ServerErrorResponse = {
      success: false,
      message: err.message,
      stack: err.stack
    }
    res.status(err.status).json(response)
  })
  // Server Error Route
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    // logging
    logger.error({
      msg: 'Internal Server Error',
      err,
      method: req.method,
      url: req.url,
      query: req.query,
      params: req.params
    })

    // response
    const response: ServerErrorResponse = {
      success: false,
      message: 'Internal server error',
      stack: err.stack
    }
    res.status(500).json(response)
  })

  return app
}
