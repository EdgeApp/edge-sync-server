import bodyParser from 'body-parser'
import cors from 'cors'
import express, { Express, NextFunction, Request, Response } from 'express'
import nano from 'nano'

import { Config } from './config'
import { logger } from './logger'
import { ApiClientError, ApiErrorResponse, StoreData } from './types'
import { makeApiClientError } from './util/utils'
import { v2Router } from './v2Router'

export interface AppState {
  config: Config
  dataStore: nano.DocumentScope<StoreData>
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
  app.use('/api/v2', v2Router(appState))

  // 404 Error Route
  app.use((_req, _res, next) => {
    next(makeApiClientError(404, 'not found'))
  })

  // Client Error Route
  app.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
    if (!(err instanceof ApiClientError)) {
      return next(err)
    }

    const response: ApiErrorResponse = {
      success: false,
      message: err.message,
      error: err.stack
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
    const response: ApiErrorResponse = {
      success: false,
      message: 'Internal server error'
    }
    res.status(500).json({ ...response, error: err.stack })
  })

  return app
}
