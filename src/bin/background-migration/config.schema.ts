import { asArray, asNumber, asObject, asString } from 'cleaners'

export const asConfig = asObject({
  dataDir: asString,
  sshHosts: asArray(asString),
  remoteReposDir: asString,
  syncServer: asString,
  migrationEndpoint: asString,
  concurrency: asNumber
})
