import { Router } from 'express'

import { configRouter } from './routes/config'
import { getUpdatesRouter } from './routes/getUpdates'
import { repoRouter } from './routes/repo'
import { updateFilesRouter } from './routes/updateFiles'

export const v3Router = Router()

v3Router.use(configRouter)
v3Router.use(getUpdatesRouter)
v3Router.use(repoRouter)
v3Router.use(updateFilesRouter)
