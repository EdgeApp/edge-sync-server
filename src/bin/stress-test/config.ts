import {
  asArray,
  asBoolean,
  asMap,
  asNumber,
  asObject,
  asString
} from 'cleaners'

export type Config = ReturnType<typeof asConfig>
export const asConfig = asObject({
  verbose: asBoolean,
  clusters: asMap(asArray(asString)),
  repoCount: asNumber,
  repoPrefix: asString,
  repoUpdatesPerMin: asNumber,
  repoUpdateIncreaseRate: asNumber,
  maxUpdatesPerRepo: asNumber,
  repoSyncTimeout: asNumber,
  fileByteSizeRange: asArray(asNumber),
  fileCountRange: asArray(asNumber)
})

export const configSample: Config = {
  verbose: false,
  clusters: {
    us: [
      'https://sync-us1.edge.app',
      'https://sync-us2.edge.app',
      'https://sync-us3.edge.app',
      'https://sync-us4.edge.app'
    ],
    eu: [
      'https://sync-eu1.edge.app',
      'https://sync-eu2.edge.app',
      'https://sync-eu3.edge.app',
      'https://sync-eu4.edge.app'
    ]
  },
  repoCount: 10,
  repoPrefix: 'ed9e',
  repoUpdatesPerMin: 2,
  repoUpdateIncreaseRate: 1.1,
  maxUpdatesPerRepo: 100,
  repoSyncTimeout: 60000,
  fileByteSizeRange: [1, 4],
  fileCountRange: [1, 10]
}