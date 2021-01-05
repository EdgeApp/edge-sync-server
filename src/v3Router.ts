import { Router } from 'express'

import { configRouter } from './routes/config'
import { getFilesRouter } from './routes/getFiles'
import { getUpdatesRouter } from './routes/getUpdates'
import { repoRouter } from './routes/repo'
import { updateFilesRouter } from './routes/updateFiles'
import { AppState } from './server'

export const v3Router = (appState: AppState): Router => {
  const router = Router()

  router.use(configRouter(appState))
  router.use(getFilesRouter(appState))
  router.use(getUpdatesRouter(appState))
  router.use(repoRouter(appState))
  router.use(updateFilesRouter(appState))

  return router
}
