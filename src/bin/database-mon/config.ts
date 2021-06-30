import { asArray, asBoolean, asObject, asOptional, asString } from 'cleaners'

export type Config = ReturnType<typeof asConfig>
export const asConfig = asObject({
  humanize: asOptional(asBoolean),
  instances: asArray(
    asObject({
      couchUrl: asString,
      couchDatabase: asString
    })
  )
})

export const configSample: Config = {
  humanize: false,
  instances: [
    {
      couchUrl: 'http://user:password@localhost:5984',
      couchDatabase: 'sync_store'
    }
  ]
}
