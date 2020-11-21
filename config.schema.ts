import { asNumber, asObject, asString } from 'cleaners'

export const asConfig = asObject({
  couchAdminPassword: asString,
  couchHost: asString, // localhost
  couchPort: asString, // 5984
  httpPort: asNumber, // 8000
  maxPageSize: asNumber // 100
})
