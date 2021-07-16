import { expect } from 'chai'

import { numbEndpoint, syncKeyToRepoId } from '../../src/util/security'

describe('Unit: numbEndpoint', () => {
  it('will replace sensative information in url', () => {
    const map = {
      '/api/v2/store/abcdef/some/path': '/api/v2/store/***/some/path',
      '/api/v2/store/abcdef/rest': '/api/v2/store/***/rest',
      '/api/v2/store/abcdef/': '/api/v2/store/***/',
      '/api/v2/store/abcdef': '/api/v2/store/***'
    }

    for (const [url, expected] of Object.entries(map)) {
      const { url: numbedUrl } = numbEndpoint(url)
      expect(numbedUrl).equal(expected)
    }
  })
  it('will return repoId', () => {
    const urls = [
      '/api/v2/store/0000000000000000000000000000000000000000/some/path',
      '/api/v2/store/0000000000000000000000000000000000000000/rest',
      '/api/v2/store/0000000000000000000000000000000000000000/',
      '/api/v2/store/0000000000000000000000000000000000000000'
    ]
    const expected = syncKeyToRepoId('0000000000000000000000000000000000000000')

    for (const url of urls) {
      const { repoId } = numbEndpoint(url)
      expect(repoId).equal(expected)
    }
  })
})
