import { exec as execCb } from 'child_process'
import { makeConfig } from 'cleaner-config'
import { asJSON, asMaybe, asUnknown } from 'cleaners'
import pino from 'pino'
import { promisify } from 'util'

import { asConfig } from '../stress-test/config'

const exec = promisify(execCb)
const logger = pino()

// Config:

const configFile = process.env.CONFIG ?? 'config.stress.json'
const config = makeConfig(asConfig, configFile)

// Force non-verbosity
config.verbose = false

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
  while (true) {
    logger.info({ msg: 'running stress test', config })

    try {
      const { stdout, stderr } = await exec(
        `yarn -s test.stress '${JSON.stringify(config)}'`,
        {
          encoding: 'utf-8'
        }
      )

      const output = asMaybe(asJSON(asUnknown), stdout)(stdout)
      const error = asMaybe(asJSON(asUnknown), stderr)(stderr)

      logger.info({ msg: 'finished stress test', output, error })
    } catch (err) {
      updateRepoPrefix()

      logger.error({
        msg: 'failed stress test',
        err,
        message: err.message,
        stack: err.stack,
        name: err.name
      })
    }
  }
}

main().catch(err => {
  logger.fatal({ level: 'error', err })
  process.exit(1)
})
