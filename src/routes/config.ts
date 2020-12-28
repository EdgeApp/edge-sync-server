import Router from 'express-promise-router'

import { config } from '../config'
import { makeApiResponse } from '../util/utils'

interface ConfigGetResponseData {
  maxPageSize: number
}

export const configRouter = Router()

configRouter.get('/config', async (req, res) => {
  // Send response
  res.status(200).json(
    makeApiResponse<ConfigGetResponseData>({ maxPageSize: config.maxPageSize })
  )
})
