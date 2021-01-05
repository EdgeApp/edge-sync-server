import { Router } from 'express'
import PromiseRouter from 'express-promise-router'

import { config } from '../config'
import { AppState } from '../server'
import { makeApiResponse } from '../util/utils'

interface ConfigGetResponseData {
  maxPageSize: number
}

export const configRouter = (_appState: AppState): Router => {
  const router = PromiseRouter()

  router.get('/config', async (req, res) => {
    // Send response
    res.status(200).json(
      makeApiResponse<ConfigGetResponseData>({
        maxPageSize: config.maxPageSize
      })
    )
  })

  return router
}
