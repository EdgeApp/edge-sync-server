import { config } from '../src/config'
import { nano } from '../src/db'

export const apiSuite = (name: string, test: () => void): void => {
  describe(name, () => {
    before(async () => {
      try {
        await nano.db.create(config.couchDatabase)
      } catch (error) {
        if (error.error !== 'file_exists') {
          throw error
        }
      }
    })
    test()
    after(async () => {
      try {
        await nano.db.destroy(config.couchDatabase)
      } catch (error) {
        if (error.error !== 'not_found') {
          throw error
        }
      }
    })
  })
}
