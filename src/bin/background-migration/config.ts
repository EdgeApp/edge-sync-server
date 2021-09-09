import { makeConfig } from 'cleaner-config'
import { asArray, asNumber, asObject, asOptional, asString } from 'cleaners'

export const asConfig = asObject({
  dataDir: asOptional(asString, '../data/background-migration'),
  sshHosts: asOptional(asArray(asString), [
    'bitz@git-migration-uk.edge.app',
    'bitz@git-migration-wusa.edge.app',
    'bitz@git-migration-eusa.edge.app'
  ]),
  remoteReposDir: asOptional(asString, '/home/bitz/www/repos/'),
  syncServer: asOptional(asString, 'http://localhost:8008'),
  migrationEndpoint: asOptional(asString, '/api/v2/migrate/:syncKey'),
  concurrency: asOptional(asNumber, 10)
})

const configFile = process.env.CONFIG ?? 'config.migration.json'

export const config = makeConfig(asConfig, configFile)
