import { Router } from 'express'
import { Serverlet } from 'serverlet'

import {
  ExpressRequest,
  makeExpressMiddleware,
  nextRoute
} from '../../adapters/makeExpressMiddleware'
import { logger } from '../../logger'
import { AppStateRequest, withAppState } from '../../middleware/withAppState'
import { withMethod } from '../../middleware/withMethod'
import { PathParamsRequest, withPath } from '../../middleware/withPath'
import { PinoRequest, withPino } from '../../middleware/withPino'
import { AppState } from '../../server'
import { getStoreRoute } from './getStore'
import { postStoreRoute } from './postStore'
import { putStoreRouter } from './putStore'

// Application request type including all used middleware
export type AppRoute = Serverlet<
  AppStateRequest & ExpressRequest & PathParamsRequest & PinoRequest
>

export const allRoutes = withPath(
  {
    '/store/:syncKey{/:hash}?': withMethod(
      {
        GET: getStoreRoute,
        POST: postStoreRoute
      },
      nextRoute
    )
  },
  nextRoute
)

export const makeRouter = (appState: AppState): Router => {
  const router = Router()

  // Serverlets
  const routesWithLogger = withPino(logger, allRoutes)
  const appRoutes = withAppState(appState, routesWithLogger)
  router.use('/', makeExpressMiddleware(appRoutes))

  router.use(putStoreRouter(appState))

  return router
}
