#!/usr/bin/env node -r sucrase/register

import fetch from 'node-fetch'

import { asConfig, Config, configSample } from './config'

interface SuccessfulResponse {
  success: true
  data: ResponseData
}

interface UnsuccessfulResponse {
  success: false
  message: string
  error: Error
}

type ResponseData = any

interface Result {
  from: string
  to: string
  attempts: number
  repoStartTs: number
  repoUpdateTs: number
  checkStartTs: number
  checkUpdateTs: number
  checkEndTs: number
  timeElapsed: number
}

const repoNotFoundMessageRegex = /^Repo '.+' not found$/

let repoStartTs: number
let repoUpdateTs: number

async function main(config: Config): Promise<void> {
  const { repoId } = config

  const serverBaseUrls = config.hostnames
    .map<[number, string]>(host => [Math.random(), host])
    .sort(([a], [b]) => a - b)
    .map(([a, host]) => `https://${host}`)

  const fromServer = serverBaseUrls[0]
  const otherServers = serverBaseUrls.slice(1)

  await initializeRepo(fromServer, repoId)
  await doUpdate(fromServer, repoId)

  const checkStartTs = Date.now()

  const results: Result[] = await Promise.all(
    otherServers.map(serverUrl =>
      pingForUpdate(serverUrl, repoId).then(({ attempts, checkUpdateTs }) => {
        const checkEndTs = Date.now()
        const timeElapsed = checkEndTs - checkStartTs

        const result: Result = {
          from: fromServer,
          to: serverUrl,
          attempts,
          repoStartTs,
          repoUpdateTs,
          checkStartTs,
          checkUpdateTs,
          checkEndTs,
          timeElapsed
        }
        return result
      })
    )
  )

  print(results)
}

async function initializeRepo(
  serverUrl: string,
  repoId: string
): Promise<number> {
  try {
    const getUpdatesRes = await request(
      'POST',
      `${serverUrl}/api/v3/getUpdates`,
      {
        repoId,
        timestamp: 0
      }
    )

    repoStartTs = getUpdatesRes.data.timestamp

    return repoStartTs
  } catch (error) {
    if (!repoNotFoundMessageRegex.test(error.response?.message)) {
      throw error
    }

    const repoRes = await request('PUT', `${serverUrl}/api/v3/repo`, {
      repoId
    })

    repoStartTs = repoRes.data.timestamp

    return repoRes.data.timestamp
  }
}

async function doUpdate(serverUrl: string, repoId: string): Promise<void> {
  const body = {
    timestamp: repoStartTs,
    repoId,
    paths: {
      '/file': {
        box: {
          iv_hex: '',
          encryptionType: 0,
          data_base64: 'test'
        }
      }
    }
  }

  const updateFilesRes = await request(
    'POST',
    `${serverUrl}/api/v3/updateFiles`,
    body
  )

  repoUpdateTs = updateFilesRes.data.timestamp
}

function pingForUpdate(
  serverUrl: string,
  repoId: string,
  attempts: number = 0
): Promise<{ attempts: number; checkUpdateTs: number }> {
  const body = {
    repoId,
    timestamp: 0
  }

  return request('POST', `${serverUrl}/api/v3/getUpdates`, body)
    .then(getUpdatesRes => getUpdatesRes.data.timestamp as number)
    .then(getUpdateTimestamp => {
      ++attempts

      if (getUpdateTimestamp < repoUpdateTs) {
        return delay(500).then(() => pingForUpdate(serverUrl, repoId, attempts))
      } else if (getUpdateTimestamp > repoUpdateTs) {
        throw new Error(
          `Assertion failed: other servers should not be ahead of update time`
        )
      }

      return { attempts, checkUpdateTs: getUpdateTimestamp }
    })
    .catch(error => {
      if (!repoNotFoundMessageRegex.test(error.response?.message)) {
        throw error
      }
      return delay(500).then(() => pingForUpdate(serverUrl, repoId, attempts))
    })
}

const request = async (
  method: string,
  url: string,
  body?: object
): Promise<SuccessfulResponse> => {
  const json = body != null ? JSON.stringify(body) : undefined
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json'
    },
    body: json
  })

  const responseText = await response.text()
  let responseObject: SuccessfulResponse | UnsuccessfulResponse

  try {
    responseObject = JSON.parse(responseText)
  } catch (err) {
    throw new RequestError(
      `${method} ${url} failed to parse JSON response.`,
      body,
      responseText
    )
  }

  if (!responseObject.success) {
    throw new RequestError(`${method} ${url} failed.`, body, responseObject)
  }

  return responseObject
}

function print(msg: object): void {
  console.log(JSON.stringify(msg, null, 2))
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve, reject) => setTimeout(resolve, ms))
}

class RequestError extends Error {
  body?: object
  response: object | string

  constructor(
    message: string | undefined,
    body: object | undefined,
    response: object | string
  ) {
    super(message)
    this.body = body
    this.response = response
  }
}

// Startup:

try {
  const jsonArg = process.argv[2]

  if (jsonArg == null) {
    errHandler(
      `Missing json config argument:\n\n${JSON.stringify(
        configSample,
        null,
        2
      )}`
    )
  }

  const config: Config = asConfig(JSON.parse(jsonArg))

  main(config).catch(error => {
    errHandler(error)
  })
} catch (error) {
  if (error instanceof TypeError) {
    throw new Error(`Invalid JSON input argument: ${error.message}`)
  }
  throw error
}

process.on('unhandledRejection', error => {
  console.warn(`UNHANDLED PROMISE!!!`)
  if (error instanceof Error) errHandler(error)
})

function errHandler(err: Error | string): void {
  console.error(err)
  process.exit(1)
}
