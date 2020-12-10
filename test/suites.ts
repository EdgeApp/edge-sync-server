import { nano } from '../src/db'

export const apiSuite = (name: string, test: () => void): void => {
  const { DATABASE } = process.env

  if (typeof DATABASE !== 'string') {
    throw new Error('Missing DATABASE env var')
  }

  describe(name, () => {
    before(async () => {
      try {
        await nano.db.create(DATABASE)
      } catch (error) {
        if (error.error !== 'file_exists') {
          throw error
        }
      }
    })
    test()
    after(async () => {
      try {
        await nano.db.destroy(DATABASE)
      } catch (error) {
        if (error.error !== 'not_found') {
          throw error
        }
      }
    })
  })
}
