import bodyParser from 'body-parser'
// import { asArray, asObject, asOptional } from 'cleaners'
import cors from 'cors'
import express from 'express'

import config from '../config.json'
import { filesRouter } from './routes/files'
import { repoRouter } from './routes/repo'
import { updatesRouter } from './routes/updates'
import { ApiErrorResponse, asApiClientError } from './types'

async function main(): Promise<void> {
  const app = express()

  // Middleware
  app.use(bodyParser.json({ limit: '1mb' }))
  app.use(cors())
  app.use('/', express.static('dist'))

  // Routes
  app.use('/api/v3', [repoRouter, filesRouter, updatesRouter])

  // Client Error Route
  app.use((err, _req, res, next) => {
    if (err instanceof Error) {
      return next(err)
    }

    try {
      const error = asApiClientError(err)
      const status = error.status
      const response: ApiErrorResponse = {
        success: false,
        message: error.message
      }
      res.status(status).json(response)
    } catch (error) {
      return next(err)
    }
  })
  // Server Error Route
  app.use((err, _req, res, _next) => {
    // logging
    console.error(err)

    // response
    const response: ApiErrorResponse = {
      success: false,
      message: 'Internal server error'
    }
    res.status(500).json(response)
  })

  // Instantiate server
  app.listen(config.httpPort, () => {
    console.log('Server is listening on:', config.httpPort)
  })
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
