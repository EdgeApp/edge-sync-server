import { expect } from 'chai'

import { VALID_PATH_REGEX, VALID_REPO_ID_REGEX } from '../../src/types'

describe('Unit: Regexes', () => {
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
  it('VALID_REPO_ID_REGEX', () => {
    const validRepoIds = [
      '0123456789012345678901234567890123456789',
      'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
      'abcdef0123456789abcdef0123456789abcdef01'
    ]
    const invalidRepoIds = [
      '01234567890123456789012345678901234567891',
      '012345678901234567890123456789',
      'xxxdefabcdefabcdefabcdefabcdefabcdefabcd',
      'invalid',
      'abcdef0123456789 abcdef0123456789abcdef0',
      'abcdef0123456789-abcdef0123456789abcdef0',
      'abcdef0123456789.abcdef0123456789abcdef0',
      '01234567890123456789\n1234567890123456789'
    ]

    validRepoIds.forEach(repoId =>
      expect(
        VALID_REPO_ID_REGEX.test(repoId),
        `valid repoId: ${repoId}`
      ).equals(true)
    )

    invalidRepoIds.forEach(repoId =>
      expect(
        VALID_REPO_ID_REGEX.test(repoId),
        `invalid repoId: ${repoId}`
      ).equals(false)
    )
  })
})
