import Router from 'express-promise-router'

import { config } from '../config'
import { ApiResponse } from '../types'

interface ConfigGetResponseData {
  maxPageSize: number
}

export const configRouter = Router()

configRouter.get('/config', async (req, res) => {
  // Send response
  const response: ApiResponse<ConfigGetResponseData> = {
    success: true,
    data: {
      maxPageSize: config.maxPageSize
    }
  }
  res.status(200).json(response)
})
