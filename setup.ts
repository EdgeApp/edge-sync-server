import { writeFileSync } from 'fs'

import { Config, configTemplate } from './src/config.schema'

async function main(): Promise<void> {
  const config: Config = configTemplate

  writeFileSync('config.json', JSON.stringify(config, null, 2), 'utf8')
}

main().catch(err => {
  throw err
})
