import { asArray, asObject, asString } from 'cleaners'

export type Config = ReturnType<typeof asConfig>
export const asConfig = asObject({
  hostnames: asArray(asString),
  syncKey: asString
})

export const configSample: Config = {
  hostnames: ['server-a.com', 'server-b.com'],
  syncKey: '0000000000000000000000000000000000000000'
}
