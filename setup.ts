import { writeFileSync } from 'fs'
import minimist from 'minimist'
import { createInterface } from 'readline'
import { Writable } from 'stream'

import { Config, configSample } from './src/config.schema'

const argv = minimist(process.argv.slice(2))

const isProduction = argv.dev !== true
const password = process.env.COUCH_PASSWORD

async function main(): Promise<void> {
  const couchPassword: string =
    typeof password === 'string' && password !== ''
      ? password
      : await captureInput('Enter CouchDB password: ', true)

  const config: Config = isProduction
    ? {
        ...configSample,
        couchPassword,
        couchSharding: {
          q: 512,
          n: 2
        },
        httpPort: 8008,
        migrationOriginServers: [
          'https://git-uk.edge.app/repos/',
          'https://git3.airbitz.co/repos/',
          'https://git-eusa.edge.app/repos/'
        ],
        migrationTmpDir: '/tmp/apps/edge-sync-server/'
      }
    : { ...configSample, couchPassword }

  if (isProduction) delete config.instanceCount

  writeFileSync('config.json', JSON.stringify(config, null, 2), 'utf8')
}

main().catch(err => {
  throw err
})

function captureInput(prompt: string, muted: boolean = false): Promise<string> {
  let isMuted: boolean = false
  const mutableStdout = new Writable({
    write: function (chunk, encoding, callback) {
      if (!isMuted) process.stdout.write(chunk, encoding)
      callback()
    }
  })

  const rl = createInterface({
    input: process.stdin,
    output: mutableStdout,
    terminal: true
  })

  return new Promise((resolve, reject) => {
    rl.question(prompt, val => {
      resolve(val)
      rl.close()
    })
    isMuted = muted
  })
}
