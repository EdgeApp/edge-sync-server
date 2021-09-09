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
  destinationServers: asOptional(asArray(asString), [
    'https://sync-us1.edge.app',
    'https://sync-us2.edge.app',
    'https://sync-us3.edge.app',
    'https://sync-us4.edge.app',
    'https://sync-us5.edge.app',
    'https://sync-us6.edge.app',
    'https://sync-eu1.edge.app',
    'https://sync-eu2.edge.app',
    'https://sync-eu3.edge.app',
    'https://sync-eu4.edge.app',
    'https://sync-eu5.edge.app',
    'https://sync-eu6.edge.app'
  ]),
  migrationEndpoint: asOptional(asString, '/api/v2/migrate/:syncKey'),
  concurrency: asOptional(asNumber, 10)
})

const configFile = process.env.CONFIG ?? 'config.migration.json'

export const config = makeConfig(asConfig, configFile)
