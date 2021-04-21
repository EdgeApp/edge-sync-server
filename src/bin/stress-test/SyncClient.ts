import { gt } from 'biggystring'
import { randomInt } from 'crypto'
import fetch, { Response as FetchResponse } from 'node-fetch'
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
  repoTimestamps: { [syncKey: string]: TimestampRev }
  repoFilePaths: { [syncKey: string]: Set<string> }
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
      syncKey: any
      ignoreTimestamps?: boolean
      paths?: any
      timestamp?: TimestampRev
    }
  ): Promise<ApiResponse<T>> {
    const body = JSON.stringify(data)
    const url = this.endpoint(path)

    let responseJson: ApiResponse<T> | ApiErrorResponse

    const response: FetchResponse | undefined = await withRetries(
      async () => {
        let response: FetchResponse | undefined
        try {
          response = await fetch(url, {
            method,
            headers: {
              'Content-Type': 'application/json'
            },
            body
          })
        } catch (error) {
          throw new Error(
            `Request failed to fetch: ${JSON.stringify({
              error: {
                message: error.message,
                stack: error.stack
              },
              request: { url, body }
            })}`
          )
        }

        if (response.status === 502) {
          throw new Error('timeout')
        }

        return response
      },
      err => err.message === 'timeout'
    )

    const responseText = await response.text()

    try {
      responseJson = JSON.parse(responseText)
    } catch (error) {
      throw new Error(
        `Request failed to parse JSON: ${JSON.stringify(
          {
            error: {
              message: error.message,
              stack: error.stack
            },
            request: { url, body },
            response,
            status: response.status,
            responseText
          },
          null,
          2
        )}`
      )
    }

    if (!responseJson.success) {
      const error = new RequestError({ url, body }, responseJson)
      throw error
    }

    return responseJson
  }

  async createRepo(syncKey: string): Promise<any> {
    const response = await this.request<PutRepoResponse>(
      'PUT',
      '/api/v3/repo',
      {
        syncKey
      }
    )

    this.saveRepoTimestamp(syncKey, response.data.timestamp)

    return response
  }

  async updateFiles(
    syncKey: string,
    changeSet: ChangeSet
  ): Promise<ApiResponse<UpdateFilesResponse>> {
    const response = await withRetries(
      async () => {
        // Get updates for this repo in-case client is out of sync
        await this.getUpdates(syncKey)

        // Get the repo's timestamp
        const timestamp = this.getRepoTimestamp(syncKey)

        // Prepare the update body
        const body: UpdateFilesBody = {
          timestamp,
          syncKey,
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
    this.saveRepoTimestamp(syncKey, response.data.timestamp)

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
    this.saveRepoFilePaths(syncKey, paths, deleted)

    // Return response
    return response
  }

  async getUpdates(syncKey: string): Promise<ApiResponse<GetUpdatesResponse>> {
    const timestamp = this.getRepoTimestamp(syncKey)
    const body = { syncKey, timestamp }
    const response = await this.request<GetUpdatesResponse>(
      'POST',
      '/api/v3/getUpdates',
      body
    )
    const data = response.data

    if (gt(data.timestamp, timestamp)) {
      this.saveRepoTimestamp(syncKey, data.timestamp)
    }

    // Save the file paths
    this.saveRepoFilePaths(
      syncKey,
      Object.keys(response.data.paths),
      Object.keys(response.data.deleted)
    )

    return response
  }

  async randomChangeSet(
    syncKey: string,
    fileCount: number,
    fileByteSizeRange: number[]
  ): Promise<ChangeSet> {
    const changeSet: ChangeSet = {}
    const size = randomInt(fileByteSizeRange[0], fileByteSizeRange[1] + 1)

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

    const existingFilePaths = this.repoFilePaths[syncKey]

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

  getRepoTimestamp(syncKey: string): TimestampRev {
    return this.repoTimestamps[syncKey] ?? '0'
  }

  saveRepoTimestamp(syncKey: string, timestamp: TimestampRev): void {
    this.repoTimestamps[syncKey] = timestamp
  }

  saveRepoFilePaths(syncKey: string, paths: string[], deleted: string[]): void {
    for (const path of paths) {
      if (this.repoFilePaths[syncKey] == null)
        this.repoFilePaths[syncKey] = new Set()
      this.repoFilePaths[syncKey].add(path)
    }
    for (const path of deleted) {
      if (this.repoFilePaths[syncKey] == null)
        this.repoFilePaths[syncKey] = new Set()
      this.repoFilePaths[syncKey].delete(path)
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
