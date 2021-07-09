import { spawn } from 'child_process'
import { makeConfig } from 'cleaner-config'
import pino from 'pino'

import { asConfig } from './config'

const logger = pino()

// Config:

const configFile = process.env.CONFIG ?? 'config.test.repo-sync.json'
const config = makeConfig(asConfig, configFile)

// Manage repo prefix
let prefixCounter = 0
function updateRepoPrefix(): void {
  config.syncKeyPrefix = `ed9e${(prefixCounter++)
    .toString(16)
    .padStart(5, '0')}`
}
updateRepoPrefix()

// Main:

async function main(): Promise<void> {
  const child = spawn('yarn', [
    '-s',
    'test.repo-sync',
    `${JSON.stringify(config)}`
  ])

  child.stdout.setEncoding('utf8')
  child.stdout.pipe(process.stdout)
  child.stderr.pipe(process.stderr)

  // events
  child.on('exit', (code): void => {
    if (code !== null && code !== 0) {
      throw new Error(`Stress test process exited with code ${String(code)}`)
    }
  })
  child.on('error', (err): void => {
    throw err
  })
  child.on('close', (): void => {
    main().catch(err => {
      throw err
    })
  })
}

main().catch(err => {
  logger.fatal({ level: 'error', err })
  process.exit(1)
})
