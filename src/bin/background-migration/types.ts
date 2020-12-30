import { asArray, asNumber, asObject, asString } from 'cleaners'

export type Checkpoint = ReturnType<typeof asCheckpoint>
export const asCheckpoint = asObject({
  partition: asNumber,
  index: asNumber
})

export type ScanFile = ReturnType<typeof asScanFile>
export const asScanFile = asObject({
  partitionHex: asString,
  repoIds: asArray(asString)
})
