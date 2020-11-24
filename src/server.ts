import bodyParser from 'body-parser'
import cors from 'cors'
import express from 'express'

import { configRouter } from './routes/config'
import { repoRouter } from './routes/repo'
import { updateFilesRouter } from './routes/updateFiles'
import { ApiErrorResponse, asApiClientError } from './types'
import { makeApiClientError } from './utils'

export const app = express()

// Middleware
app.use(bodyParser.json({ limit: '1mb' }))
app.use(cors())
app.use('/', express.static('dist'))

// Routes
app.use('/api/v3', [configRouter, repoRouter, updateFilesRouter])

// 404 Error Route
app.use((_req, _res, next) => {
  next(makeApiClientError(404, 'not found'))
})

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
  res.status(500).json({ ...response, error: err.stack })
})
