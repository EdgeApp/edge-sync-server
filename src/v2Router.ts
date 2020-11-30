import { Router } from 'express'

import { getStoreRouter } from './v2/routes/getStore'
import { postStoreRouter } from './v2/routes/postStore'
import { putStoreRouter } from './v2/routes/putStore'

export const v2Router = Router()

v2Router.use(getStoreRouter)
v2Router.use(postStoreRouter)
v2Router.use(putStoreRouter)
