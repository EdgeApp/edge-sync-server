#!/usr/bin/env node -r sucrase/register

import fetch from 'node-fetch'
import { URL } from 'url'
import { inspect } from 'util'

import { asConfig, Config, configSample } from './config'

async function main(config: Config): Promise<void> {
  const { instances } = config

  const print = (msg: object): void => {
    const humanize = config.humanize != null && config.humanize
    if (humanize) {
      console.log(inspect(msg, { depth: Infinity, colors: true }))
    } else {
      console.log(JSON.stringify(msg))
    }
  }

  const results = await Promise.all(
    instances.map(async ({ couchUrl, couchDatabase }) => {
      const database = await getDatabaseDoc(couchUrl, couchDatabase)
      const replications = await getReplicationDocs(couchUrl)
      const url = new URL(couchUrl)
      const host = url.host

      return {
        host,
        database,
        replications
      }
    })
  )

  print(results)
}

async function getDatabaseDoc(
  couchUrl: string,
  couchDatabase: string
): Promise<number> {
  const response = await fetch(`${couchUrl}/${couchDatabase}`).then(res =>
    res.json()
  )
  return response
}

async function getReplicationDocs(couchUrl: string): Promise<any> {
  const response = await fetch(
    `${couchUrl}/_scheduler/docs/_replicator`
  ).then(res => res.json())

  return response.docs
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
