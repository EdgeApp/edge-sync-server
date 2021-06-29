import { expect } from 'chai'

import {
  VALID_PATH_REGEX,
  VALID_SYNC_KEY_REGEX
} from '../../src/types/primitive-types'

describe('Unit: Regexes', () => {
  it('VALID_PATH_REGEX', () => {
    const validPaths = [
      'file',
      'file123',
      '123',
      'file_with_underscore',
      'file-with-dash',
      'file.txt',
      '.dots',
      'dir/file',
      'dir/file123',
      'dir/123',
      'dir/file-with-dash',
      'dir/file_with_underscore',
      'dir/file.txt',
      'dir//more-slashes',
      'dir/.dots',
      'dir/.',
      'dir/../file',
      'dir/.../file',
      // Valid regex, but not valid asPath
      'back-to-root/..',
      'back-to-root/../..',
      'back-to-root/dir/../..'
    ]
    const invalidPaths = [
      '',
      ' ',
      '/leadingslash',
      'trailingslash/',
      '/',
      ' /',
      '/ ',
      '/ space',
      ' outerspace',
      'outerspace ',
      'inner space',
      '/file.',
      '/dir/file',
      '/dir/file.txt',
      '/dir/dir/file.txt',
      '/dir.dir/file.f.txt',
      '/dir space dir/dir dir/file-file.txt',
      'dir//'
    ]

    validPaths.forEach(path =>
      expect(VALID_PATH_REGEX.test(path), `valid path: ${path}`).equals(true)
    )

    invalidPaths.forEach(path =>
      expect(VALID_PATH_REGEX.test(path), `invalid path: ${path}`).equals(false)
    )
  })
  it('VALID_SYNC_KEY_REGEX', () => {
    const validSyncKeys = [
      '0123456789012345678901234567890123456789',
      'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
      'abcdef0123456789abcdef0123456789abcdef01'
    ]
    const invalidSyncKeys = [
      '01234567890123456789012345678901234567891',
      '012345678901234567890123456789',
      'xxxdefabcdefabcdefabcdefabcdefabcdefabcd',
      'invalid',
      'abcdef0123456789 abcdef0123456789abcdef0',
      'abcdef0123456789-abcdef0123456789abcdef0',
      'abcdef0123456789.abcdef0123456789abcdef0',
      '01234567890123456789\n1234567890123456789'
    ]

    validSyncKeys.forEach(syncKey =>
      expect(
        VALID_SYNC_KEY_REGEX.test(syncKey),
        `valid syncKey: ${syncKey}`
      ).equals(true)
    )

    invalidSyncKeys.forEach(syncKey =>
      expect(
        VALID_SYNC_KEY_REGEX.test(syncKey),
        `invalid syncKey: ${syncKey}`
      ).equals(false)
    )
  })
})
