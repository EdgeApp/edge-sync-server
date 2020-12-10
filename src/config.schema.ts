import { asNumber, asObject, asString } from 'cleaners'

export const asConfig = asObject({
  couchAdminPassword: asString,
  couchHost: asString, // localhost
  couchPort: asString, // 5984
  httpPort: asNumber, // 8000
  maxPageSize: asNumber, // 100
  // Git URL of the server from which to migrate repos.
  migrationOriginServer: asString,
  // Temp directory to use for repo migrations
  migrationTmpDir: asString
})
