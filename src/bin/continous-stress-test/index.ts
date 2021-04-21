import { exec as execCb } from 'child_process'
import { makeConfig } from 'cleaner-config'
import { promisify } from 'util'

import { asConfig } from '../stress-test/config'

const exec = promisify(execCb)

const configFile = process.env.CONFIG ?? 'config.stress.json'
const config = makeConfig(asConfig, configFile)

const logOut = (...args: any[]): void =>
  console.log(args.map(a => JSON.stringify(a)))
const logErr = (...args: any[]): void =>
  console.error(args.map(a => JSON.stringify(a)))

// Force non-verbosity
config.verbose = false

// Manage repo prefix
let prefixCounter = 0
function updateRepoPrefix(): void {
  config.syncKeyPrefix = `ed9e${(prefixCounter++)
    .toString(16)
    .padStart(5, '0')}`
  logOut('using config', config)
}
updateRepoPrefix()

async function main(): Promise<void> {
  while (true) {
    logOut('running stress test')

    try {
      const { stdout, stderr } = await exec(
        `yarn -s test.stress '${JSON.stringify(config)}'`,
        {
          encoding: 'utf-8'
        }
      )
      logOut('finished stress test')

      logOut(stdout)
      logErr(stderr)
    } catch (err) {
      logOut('failed stress test')

      updateRepoPrefix()

      logErr({
        err,
        message: err.message,
        stack: err.stack,
        name: err.name
      })
    }
  }
}

main().catch(err => {
  logErr(err)
  process.exit(1)
})
