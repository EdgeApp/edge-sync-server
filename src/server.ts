import bodyParser from 'body-parser'
import cors from 'cors'
import express, { Express } from 'express'
import nano from 'nano'

import { Config } from './config.schema'
import { ApiClientError, ApiErrorResponse, StoreData } from './types'
import { makeApiClientError } from './util/utils'
import { v2Router } from './v2Router'
import { v3Router } from './v3Router'

export interface AppState {
  config: Config
  dataStore: nano.DocumentScope<StoreData>
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
  app.use('/api/v3', v3Router(appState))

  // 404 Error Route
  app.use((_req, _res, next) => {
    next(makeApiClientError(404, 'not found'))
  })

  // Client Error Route
  app.use((err, _req, res, next) => {
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
  app.use((err, req, res, _next) => {
    // logging
    if (process.env.NODE_ENV !== 'test') {
      console.error({
        err,
        method: req.method,
        url: req.url,
        query: req.query,
        params: req.params,
        body: req.body
      })
    }

    // response
    const response: ApiErrorResponse = {
      success: false,
      message: 'Internal server error'
    }
    res.status(500).json({ ...response, error: err.stack })
  })

  return app
}
