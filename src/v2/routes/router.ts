import { Router } from 'express'

import { AppState } from '../../server'
import { getStoreRouter } from './getStore'
import { getMigrateStoreRouter } from './migrateStore'
import { postStoreRouter } from './postStore'
import { putStoreRouter } from './putStore'

export const makeRouter = (appState: AppState): Router => {
  const router = Router()

  router.use(getStoreRouter(appState))
  router.use(getMigrateStoreRouter(appState))
  router.use(postStoreRouter(appState))
  router.use(putStoreRouter(appState))

  return router
}
