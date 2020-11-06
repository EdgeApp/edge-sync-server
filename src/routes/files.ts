import Router from 'express-promise-router'
import { dataStore } from '../db'
import { ApiResponse, DocumentRequest, Results } from '../types'

export const filesRouter = Router()

filesRouter.get('/files', async (req, res, next) => {
  const paths: DocumentRequest = JSON.parse(req.query.paths)
  console.log(paths)
  const contents: Results = {}
  const keys: string[] = Object.keys(paths)
  for (let i = 0; i < keys.length; ++i) {
    // const path = keys[i]
    try {
      /*
			const query: DbResponse = await dataStore.get(path)
			if (query.timestamp > paths[path]) {
				contents[path] = query
			}
			*/
    } catch (e) {
      console.log(e)
      const result: ApiResponse = {
        success: false,
        message: 'Internal server error'
      }
      res.status(500).json(result)
    }
  }
  const result: ApiResponse = {
    success: true,
    response: contents
  }
  res.status(200).json(result)
})

// Get wallet transactions based on type of wallet
filesRouter.post('/files', async (req, res, next) => {
  res.status(500).send('TODO')
})
