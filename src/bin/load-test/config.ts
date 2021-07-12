import { asArray, asNumber, asObject, asString } from 'cleaners'

export type Config = ReturnType<typeof asConfig>
export const asConfig = asObject({
  // Servers
  clusters: asObject(asArray(asString)),
  // Sync Key
  syncKeyPrefix: asString,
  // Repo count
  repoCount: asNumber,
  maxRepoCount: asNumber,
  repoCountIncreaseRatePerMin: asNumber,
  // Update
  repoUpdatesPerMin: asNumber,
  // Read
  repoReadsPerMin: asNumber,
  // Payload
  fileByteSizeRange: asArray(asNumber),
  fileCountRange: asArray(asNumber),
  // Exit conditions
  maxTimeElapse: asNumber
})

export const configSample: Config = {
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

  syncKeyPrefix: 'ed9e',

  repoCount: 10,
  maxRepoCount: 2000,
  repoCountIncreaseRatePerMin: 1.5,

  repoUpdatesPerMin: 2,

  repoReadsPerMin: 12,

  fileByteSizeRange: [1, 4],
  fileCountRange: [1, 10],

  maxTimeElapse: 0
}
