import { Router } from 'express'
import { dataStore } from '../db'
import { ApiResponse, DocumentRequest, Results } from '../types'

export const updatesRouter = Router()

updatesRouter.get('/updates', async (req, res, next) => {
  res.status(500).send('TODO')
})
