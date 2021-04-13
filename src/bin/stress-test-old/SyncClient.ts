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
import { config } from './config'
import { randomBytes, randomPath } from './utils/utils'

interface FilePayload {
  [file: string]: string
}

export class SyncClient {
  baseUrl: string
  repoTimestamps: { [repoId: string]: TimestampRev }
  host: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
    this.repoTimestamps = {}
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
    filePayload: FilePayload
  ): Promise<ApiResponse<UpdateFilesResponse>> {
    const paths = Object.entries(filePayload).reduce<ChangeSet>(
      (paths, [key, value]) => {
        paths[key] = {
          box: {
            iv_hex: '',
            encryptionType: 0,
            data_base64: value
          }
        }
        return paths
      },
      {}
    )

    // Get updates for this repo in-case client is out of sync
    await this.getUpdates(repoId)

    // Get the repo's timestamp
    const timestamp = this.getRepoTimestamp(repoId)

    // Prepare the update body
    const body: UpdateFilesBody = {
      timestamp,
      repoId,
      paths
    }

    // Set the update request
    const response = await this.request<UpdateFilesResponse>(
      'POST',
      '/api/v3/updateFiles',
      body
    )

    // Save the new repo timestamp
    this.saveRepoTimestamp(repoId, response.data.timestamp)

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

    return response
  }

  async randomFilePayload(fileCount: number): Promise<FilePayload> {
    const data: FilePayload = {}
    const size = randomInt(config.fileSizeRange[0], config.fileSizeRange[1] + 1)

    for (let i = 0; i < fileCount; i++) {
      const path = randomPath()
      data[path] = randomBytes(size).toString('base64')
    }

    return data
  }

  getRepoTimestamp(repoId: string): TimestampRev {
    return this.repoTimestamps[repoId] ?? '0'
  }

  saveRepoTimestamp(repoId: string, timestamp: TimestampRev): void {
    this.repoTimestamps[repoId] = timestamp
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
