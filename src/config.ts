import { readFileSync } from 'fs'
import { join as joinPath } from 'path'

import { asConfig } from './config.schema'

let config: ReturnType<typeof asConfig>

// Read JSON file
try {
  const filePath = joinPath(`${__dirname}/../config.json`)
  const configJson = readFileSync(filePath, 'utf8')
  config = JSON.parse(configJson)
} catch (error) {
  throw new Error(`Config load failed\n${indentErrorStack(error.stack)}`)
}

// Validate config
try {
  config = asConfig(config)
} catch (error) {
  throw new Error(`Config validation failed\n${indentErrorStack(error.stack)}`)
}

// Export typed config object
export { config }

// Utility functions:

function indentErrorStack(stack: string): string {
  return stack
    .split('\n')
    .map(line => `    ${line}`)
    .join('\n')
}
