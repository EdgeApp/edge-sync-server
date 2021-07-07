import { asMaybe, Cleaner } from 'cleaners'
import { randomInt } from 'crypto'
import fetch, { Response as FetchResponse } from 'node-fetch'
import { URL } from 'url'

import {
  asServerErrorResponse,
  ServerErrorResponse
} from '../../types/primitive-types'
import { trial } from '../../util/trial'
import { withRetries } from '../../util/with-retries'
import {
  asGetStoreResponse,
  asPostStoreResponse,
  asPutStoreResponse,
  ChangeSetV2,
  GetStoreResponse,
  PostStoreBody,
  PostStoreResponse,
  PutStoreResponse
} from '../../v2/types'
import { compareHash } from './utils/repo-hash'
import { randomBytes, randomPath } from './utils/utils'

export class SyncClient {
  baseUrl: string
  clusterName: string
  repoHashes: { [syncKey: string]: string }
  repoFilePaths: { [syncKey: string]: Set<string> }
  host: string

  constructor(baseUrl: string, clusterName: string = '') {
    this.baseUrl = baseUrl
    this.clusterName = clusterName
    this.repoHashes = {}
    this.repoFilePaths = {}
    this.host = this.endpoint('').host
  }

  endpoint(path: string): URL {
    return new URL(path, this.baseUrl)
  }

  async request<ResponseType>(
    asResponseType: Cleaner<ResponseType>,
    method: string,
    path: string,
    data?: any
  ): Promise<ResponseType> {
    const body = JSON.stringify(data)
    const url = this.endpoint(path)

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
    const responseObj =
      responseText.trim() === '' ? undefined : JSON.parse(responseText)
    const responseCleaned = trial(
      () => asResponseType(responseObj),
      error => {
        const errorResponse = asMaybe(asServerErrorResponse)(responseObj)
        if (errorResponse != null)
          throw new RequestError({ url, body }, errorResponse)

        throw new Error(
          `Request failed to parse JSON: ${JSON.stringify(
            {
              error: {
                message: error.message,
                stack: error.stack
              },
              request: { method, url, body },
              response,
              status: response.status,
              responseText
            },
            null,
            2
          )}`
        )
      }
    )

    return responseCleaned
  }

  async createRepo(syncKey: string): Promise<PutStoreResponse> {
    const response = await this.request(
      asPutStoreResponse,
      'PUT',
      `/api/v2/store/${syncKey}`
    )

    this.saveRepoHash(syncKey, '')

    return response
  }

  async updateFiles(
    syncKey: string,
    changeSet: ChangeSetV2
  ): Promise<PostStoreResponse> {
    const response = await withRetries(
      async () => {
        // Get updates for this repo in-case client is out of sync
        await this.getUpdates(syncKey)

        // Get the repo's hash
        const hash = this.getRepoHash(syncKey)

        // Prepare the update body
        const body: PostStoreBody = {
          changes: changeSet
        }

        // Send the update request
        return await this.request(
          asPostStoreResponse,
          'POST',
          `/api/v2/store/${syncKey}/${hash}`,
          body
        )
      },
      err => /File is already deleted/.test(err.message)
    )

    // Save the new repo hash
    this.saveRepoHash(syncKey, response.hash)

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

  async getUpdates(syncKey: string): Promise<GetStoreResponse> {
    const hash = this.getRepoHash(syncKey)
    const response = await this.request(
      asGetStoreResponse,
      'GET',
      `/api/v2/store/${syncKey}/${hash}`
    )

    if (compareHash(response.hash, hash) === 'ahead') {
      this.saveRepoHash(syncKey, response.hash)
    }

    const availablePaths: string[] = []
    const deletedPaths: string[] = []
    for (const [path, value] of Object.keys(response.changes)) {
      if (value == null) deletedPaths.push(path)
      else availablePaths.push(path)
    }

    // Save the file paths
    this.saveRepoFilePaths(syncKey, availablePaths, deletedPaths)

    return response
  }

  async randomChangeSet(
    syncKey: string,
    fileCount: number,
    fileByteSizeRange: number[]
  ): Promise<ChangeSetV2> {
    const changeSet: ChangeSetV2 = {}
    const size = randomInt(fileByteSizeRange[0], fileByteSizeRange[1] + 1)

    for (let i = 0; i < fileCount; i++) {
      const path = randomPath()
      changeSet[path] = {
        iv_hex: '',
        encryptionType: 0,
        data_base64: randomBytes(size).toString('base64')
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

  getRepoHash(syncKey: string): string {
    return this.repoHashes[syncKey] ?? ''
  }

  saveRepoHash(syncKey: string, hash: string): void {
    this.repoHashes[syncKey] = hash
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
  response: ServerErrorResponse
  request: any

  constructor(request: any, response: ServerErrorResponse) {
    const url: string = request.url.href
    super(`Request to '${url}' failed: ${response.message}`)
    this.request = request
    this.response = response
  }
}
