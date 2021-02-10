import { asArray, asBoolean, asNumber, asObject, asString } from 'cleaners'
import { readFileSync } from 'fs'
import { join } from 'path'

export type Config = ReturnType<typeof asConfig>
export const asConfig = asObject({
  verbose: asBoolean,
  servers: asArray(asString),
  fileSizeRange: asArray(asNumber),
  fileCountRange: asArray(asNumber),
  maxOpCount: asNumber,
  startOpsPerSec: asNumber,
  opIncreaseRate: asNumber,
  repoCount: asNumber,
  repoPrefix: asString,
  pathDepth: asNumber,
  maxFileCount: asNumber,
  syncTimeout: asNumber
})

const configPath = join(
  __dirname,
  '../../../',
  process.env.CONFIG ?? 'config.stress.json'
)
const configJson = readFileSync(configPath, 'utf8')

export const config = asConfig(JSON.parse(configJson))
