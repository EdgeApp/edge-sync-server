import bodyParser from 'body-parser'
import cors from 'cors'
import { ServerErrorResponse } from 'edge-sync-client'
import express, { Express, NextFunction, Request, Response } from 'express'
import nano from 'nano'
import pinoMiddleware from 'pino-http'

import { Config } from './config'
import { logger } from './logger'
import { genReqId } from './middleware/withPino'
import { SettingsData } from './types/settings-types'
import { StoreData } from './types/store-types'
import { numbRequest, numbResponse } from './util/security'
import { ServerError } from './util/server-error'
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
  app.use(cors())
  app.use(
    pinoMiddleware({
      genReqId,
      customLogLevel: res => {
        return res.statusCode === 500
          ? 'error'
          : res.statusCode >= 500
          ? 'warn'
          : 'info'
      },
      customErrorMessage: (_error, res) => {
        return res.statusCode >= 500 ? 'server error' : 'request error'
      },
      logger,
      serializers: {
        req: numbRequest,
        res: numbResponse
      }
    })
  )
  app.use(bodyParser.json({ limit: '1mb' }))
  app.use('/', express.static('dist'))

  // Routes
  app.use('/api/v2', makeV2Router(appState))

  // 404 Error Route
  app.use((_req, _res, next) => {
    next(new ServerError(404, 'not found'))
  })

  // Error Route Handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const message = err.message ?? 'Internal Server Error'
    const statusCode =
      err instanceof ServerError ? err.status : err.statusCode ?? 500
    const response: ServerErrorResponse = {
      success: false,
      message,
      stack: undefined
    }

    // response
    res.err = err
    res.status(statusCode).json(response)
  })

  return app
}
