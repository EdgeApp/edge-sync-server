import bodyParser from 'body-parser'
// import { asArray, asObject, asOptional } from 'cleaners'
import cors from 'cors'
import express from 'express'

import config from '../config.json'

import { rootRouter } from './routes/root'
import { filesRouter } from './routes/files'
import { updatesRouter } from './routes/updates'

async function main(): Promise<void> {
  const app = express()

  // Middleware
  app.use(bodyParser.json({ limit: '1mb' }))
  app.use(cors())
  app.use('/', express.static('dist'))

  // Routes
  app.use('/api/v3', [rootRouter, filesRouter, updatesRouter])

  // Instantiate server
  app.listen(config.httpPort, () => {
    console.log('Server is listening on:', config.httpPort)
  })
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
