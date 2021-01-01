import { readFileSync } from 'fs'
import { join as joinPath } from 'path'

import { asConfig } from './config.schema'

const configPath = joinPath(
  __dirname,
  '../',
  process.env.CONFIG ?? 'config.json'
)

let config: ReturnType<typeof asConfig>

// Read JSON file
try {
  const filePath = joinPath(configPath)
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
