import { expect } from 'chai'

import { VALID_PATH_REGEX } from '../src/types'

describe('Regexes', () => {
  it('VALID_PATH_REGEX', () => {
    const validPaths = [
      '/file',
      '/file.txt',
      '/.',
      '/..',
      '/.file',
      '/file.',
      '/dir/file',
      '/dir/file.txt',
      '/dir/dir/file.txt',
      '/dir.dir/file.f.txt',
      '/dir space dir/dir dir/file-file.txt'
    ]
    const invalidPaths = ['/', 'file', 'dir/file.txt', '/ file', '/file ']

    validPaths.forEach(path =>
      expect(VALID_PATH_REGEX.test(path), `valid path: ${path}`).equals(true)
    )

    invalidPaths.forEach(path =>
      expect(VALID_PATH_REGEX.test(path), `invalid path: ${path}`).equals(false)
    )
  })
})
