import { Router } from 'express'

import { AppState } from './server'
import { getStoreRouter } from './v2/routes/getStore'
import { postStoreRouter } from './v2/routes/postStore'
import { putStoreRouter } from './v2/routes/putStore'

export const v2Router = (appState: AppState): Router => {
  const router = Router()

  router.use(getStoreRouter(appState))
  router.use(postStoreRouter(appState))
  router.use(putStoreRouter(appState))

  return router
}
