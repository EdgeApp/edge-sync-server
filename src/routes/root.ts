import Router from 'express-promise-router'
import { dataStore } from '../db'
import { StoreCreate, ApiResponse, StoreRoot } from '../types'

export const rootRouter = Router()

rootRouter.put('/', async (req, res, next) => {
  const repoInfo: StoreCreate = req.body
  const path: string = `${repoInfo.repoid}:/`

  try {
    // Check that the store does not exist...there must be a better way to do this
    await dataStore.head(path)
    const result: ApiResponse = {
      success: false,
      message: 'Datastore already exists'
    }
    res.status(409).json(result)
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
      data
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
