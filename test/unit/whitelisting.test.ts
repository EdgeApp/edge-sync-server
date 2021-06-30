import { expect } from 'chai'

import { defaultAccessSettings } from '../../src/db/settings-db'
import { AccessSettings } from '../../src/types/settings-types'
import { passWhitelistApiKeys, passWhitelistIps } from '../../src/whitelisting'

describe('Unit: passWhitelistIps', () => {
  it('Will pass any IP with no settings', () => {
    const accessSettings: AccessSettings = {
      ...defaultAccessSettings,
      ipWhitelist: {}
    }

    expect(passWhitelistIps(accessSettings, '200.0.0.1'))
    expect(passWhitelistIps(accessSettings, '404.0.0.1'))
  })
  it('Will pass specific IP with settings', () => {
    const accessSettings: AccessSettings = {
      ...defaultAccessSettings,
      ipWhitelist: {
        '200.0.0.1': true,
        '200.0.0.2': true,
        '200.0.0.3': true
      }
    }

    expect(passWhitelistIps(accessSettings, '200.0.0.1'))
    expect(passWhitelistIps(accessSettings, '200.0.0.2'))
    expect(passWhitelistIps(accessSettings, '200.0.0.3'))
    expect(!passWhitelistIps(accessSettings, '404.0.0.1'))
    expect(!passWhitelistIps(accessSettings, '200.0.0.404'))
  })
})

describe('Unit: passWhitelistApiKeys', () => {
  it('Will pass any API key with no settings', () => {
    const accessSettings: AccessSettings = {
      ...defaultAccessSettings,
      apiKeyWhitelist: {}
    }

    expect(passWhitelistApiKeys(accessSettings, '200.0.0.1'))
    expect(passWhitelistApiKeys(accessSettings, '404.0.0.1'))
  })
  it('Will pass specific API key with settings', () => {
    const accessSettings: AccessSettings = {
      ...defaultAccessSettings,
      apiKeyWhitelist: {
        secret1: true,
        secret2: true,
        secret3: true
      }
    }

    expect(passWhitelistApiKeys(accessSettings, 'secret1'))
    expect(passWhitelistApiKeys(accessSettings, 'secret2'))
    expect(passWhitelistApiKeys(accessSettings, 'secret3'))
    expect(!passWhitelistApiKeys(accessSettings, 'secret4'))
    expect(!passWhitelistApiKeys(accessSettings, 'secret5'))
  })
})
