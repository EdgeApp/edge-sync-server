import { asArray, asObject, asString } from 'cleaners'

export type Config = ReturnType<typeof asConfig>
export const asConfig = asObject({
  hostnames: asArray(asString),
  repoId: asString
})

export const configSample: Config = {
  hostnames: ['server-a.com', 'server-b.com'],
  repoId: '0000000000000000000000000000000000000000'
}
