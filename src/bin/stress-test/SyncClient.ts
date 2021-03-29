import { gt } from 'biggystring'
import { randomInt } from 'crypto'
import fetch from 'node-fetch'
import { URL } from 'url'

import {
  ApiErrorResponse,
  ApiResponse,
  ChangeSet,
  GetUpdatesResponse,
  PutRepoResponse,
  TimestampRev,
  UpdateFilesBody,
  UpdateFilesResponse
} from '../../types'
import { withRetries } from '../../util/utils'
import { randomBytes, randomPath } from './utils/utils'

export class SyncClient {
  baseUrl: string
  clusterName: string
  repoTimestamps: { [repoId: string]: TimestampRev }
  repoFilePaths: { [repoId: string]: Set<string> }
  host: string

  constructor(baseUrl: string, clusterName: string = '') {
    this.baseUrl = baseUrl
    this.clusterName = clusterName
    this.repoTimestamps = {}
    this.repoFilePaths = {}
    this.host = this.endpoint('').host
  }

  endpoint(path: string): URL {
    return new URL(path, this.baseUrl)
  }

  async request<T>(
    method: string,
    path: string,
    data: {
      repoId: any
      ignoreTimestamps?: boolean
      paths?: any
      timestamp?: TimestampRev
    }
  ): Promise<ApiResponse<T>> {
    const body = JSON.stringify(data)
    const url = this.endpoint(path)

    let responseJson: ApiResponse<T> | ApiErrorResponse
    let response

    try {
      response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json'
        },
        body
      })
      responseJson = await response.json()
    } catch (err) {
      throw new Error(
        `Request failed: ${JSON.stringify({
          request: { url, body },
          response
        })}`
      )
    }

    if (!responseJson.success) {
      const error = new RequestError({ url, body }, responseJson)
      throw error
    }

    return responseJson
  }

  async createRepo(repoId: string): Promise<any> {
    const response = await this.request<PutRepoResponse>(
      'PUT',
      '/api/v3/repo',
      {
        repoId
      }
    )

    this.saveRepoTimestamp(repoId, response.data.timestamp)

    return response
  }

  async updateFiles(
    repoId: string,
    changeSet: ChangeSet
  ): Promise<ApiResponse<UpdateFilesResponse>> {
    const response = await withRetries(
      async () => {
        // Get updates for this repo in-case client is out of sync
        await this.getUpdates(repoId)

        // Get the repo's timestamp
        const timestamp = this.getRepoTimestamp(repoId)

        // Prepare the update body
        const body: UpdateFilesBody = {
          timestamp,
          repoId,
          paths: changeSet
        }

        // Send the update request
        return await this.request<UpdateFilesResponse>(
          'POST',
          '/api/v3/updateFiles',
          body
        )
      },
      err => /File is already deleted/.test(err.message)
    )

    // Save the new repo timestamp
    this.saveRepoTimestamp(repoId, response.data.timestamp)

    // Save the file paths
    const [paths, deleted] = Object.entries(changeSet).reduce<
      [string[], string[]]
    >(
      ([paths, deleted], [path, change]) => {
        if (change == null) {
          deleted.push(path)
        } else {
          paths.push(path)
        }

        return [paths, deleted]
      },
      [[], []]
    )
    this.saveRepoFilePaths(repoId, paths, deleted)

    // Return response
    return response
  }

  async getUpdates(repoId: string): Promise<ApiResponse<GetUpdatesResponse>> {
    const timestamp = this.getRepoTimestamp(repoId)
    const body = { repoId, timestamp }
    const response = await this.request<GetUpdatesResponse>(
      'POST',
      '/api/v3/getUpdates',
      body
    )
    const data = response.data

    if (gt(data.timestamp, timestamp)) {
      this.saveRepoTimestamp(repoId, data.timestamp)
    }

    // Save the file paths
    this.saveRepoFilePaths(
      repoId,
      Object.keys(response.data.paths),
      Object.keys(response.data.deleted)
    )

    return response
  }

  async randomChangeSet(
    repoId: string,
    fileCount: number,
    fileByteSizeRange: number[]
  ): Promise<ChangeSet> {
    const changeSet: ChangeSet = {}
    const size = randomInt(fileByteSizeRange[0], fileByteSizeRange[1])

    for (let i = 0; i < fileCount; i++) {
      const path = randomPath()
      changeSet[path] = {
        box: {
          iv_hex: '',
          encryptionType: 0,
          data_base64: randomBytes(size).toString('base64')
        }
      }
    }

    const existingFilePaths = this.repoFilePaths[repoId]

    // Sprinkle in some random deletions
    if (existingFilePaths != null) {
      Object.entries(changeSet).forEach(([path, change]) => {
        if (existingFilePaths.has(path)) {
          changeSet[path] = Math.round(Math.random()) === 0 ? change : null
        }
      })
    }

    return changeSet
  }

  getRepoTimestamp(repoId: string): TimestampRev {
    return this.repoTimestamps[repoId] ?? '0'
  }

  saveRepoTimestamp(repoId: string, timestamp: TimestampRev): void {
    this.repoTimestamps[repoId] = timestamp
  }

  saveRepoFilePaths(repoId: string, paths: string[], deleted: string[]): void {
    for (const path of paths) {
      if (this.repoFilePaths[repoId] == null)
        this.repoFilePaths[repoId] = new Set()
      this.repoFilePaths[repoId].add(path)
    }
    for (const path of deleted) {
      if (this.repoFilePaths[repoId] == null)
        this.repoFilePaths[repoId] = new Set()
      this.repoFilePaths[repoId].delete(path)
    }
  }
}

export class RequestError extends Error {
  response: ApiErrorResponse
  request: any

  constructor(request: any, response: ApiErrorResponse) {
    const url: string = request.url.href
    super(`Request to '${url}' failed: ${response.message}`)
    this.request = request
    this.response = response
  }
}
