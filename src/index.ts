import bodyParser from 'body-parser'
// import { asArray, asObject, asOptional } from 'cleaners'
import cors from 'cors'
import express from 'express'
import nano from 'nano'

import config from '../config.json'
import {
  ApiResponse,
  DocumentRequest,
  Results,
  StoreCreate,
  StoreRoot
} from './types'

const url = `http://admin:${config.couchAdminPassword}@${config.couchHost}:${config.couchPort}`
const dataStore = nano(url).db.use('datastore')

async function main(): Promise<void> {
  const app = express()

  // Start the core, with Bitcoin enabled:
  app.use(bodyParser.json({ limit: '1mb' }))
  app.use(cors())
  app.use('/', express.static('dist'))

  app.put('/api/v3/', async (req, res, next) => {
    const repoInfo: StoreCreate = req.body
    const path: string = `${repoInfo.repoid}:/`

    try {
      // Check that the store does not exist...there must be a better way to do this
      await dataStore.head(path)
      const result: ApiResponse = {
        success: false,
        message: 'Datastore already exists'
      }
      res.status(401).json(result)
      return
    } catch (e) {
      // ignore
    }

    try {
      const data: StoreRoot = {
        files: {},
        timestamp: new Date().getTime(),
        lastGitHash: repoInfo.lastgithash,
        lastGitTime: repoInfo.lastgittime,
        size: 0,
        sizeLastCreated: 0,
        maxSize: 0
      }
      const query = await dataStore.insert(data, path)
      data._rev = query.rev
      data._id = query.id
      const result: ApiResponse = {
        success: true,
        response: data
      }
      res.status(201).json(result)
    } catch (e) {
      console.log(e)
      const result: ApiResponse = {
        success: false,
        message: 'Internal server error'
      }
      res.status(500).json(result)
    }
  })

  // Get wallet transactions based on type of wallet
  app.get('/api/v3/files', async (req, res, next) => {
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
  app.post('/api/v3/files', async (req, res, next) => {
    res.status(500).send('TODO')
  })

  app.get('/api/v3/updates', async (req, res, next) => {
    res.status(500).send('TODO')
  })

  app.listen(config.httpPort, () => {
    console.log('Server is listening on:', config.httpPort)
  })
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
