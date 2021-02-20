import { expect } from 'chai'

import { defaultStoreSettings } from '../../src/storeSettings'
import { StoreSettings } from '../../src/types'
import { passWhitelistApiKeys, passWhitelistIps } from '../../src/whitelisting'

describe('Unit: passWhitelistIps', () => {
  it('Will pass any IP with no settings', () => {
    const storeSettings: StoreSettings = {
      ...defaultStoreSettings,
      ipWhitelist: {}
    }

    expect(passWhitelistIps(storeSettings, '200.0.0.1'))
    expect(passWhitelistIps(storeSettings, '404.0.0.1'))
  })
  it('Will pass specific IP with settings', () => {
    const storeSettings: StoreSettings = {
      ...defaultStoreSettings,
      ipWhitelist: {
        '200.0.0.1': true,
        '200.0.0.2': true,
        '200.0.0.3': true
      }
    }

    expect(passWhitelistIps(storeSettings, '200.0.0.1'))
    expect(passWhitelistIps(storeSettings, '200.0.0.2'))
    expect(passWhitelistIps(storeSettings, '200.0.0.3'))
    expect(!passWhitelistIps(storeSettings, '404.0.0.1'))
    expect(!passWhitelistIps(storeSettings, '200.0.0.404'))
  })
})

describe('Unit: passWhitelistApiKeys', () => {
  it('Will pass any API key with no settings', () => {
    const storeSettings: StoreSettings = {
      ...defaultStoreSettings,
      apiKeyWhitelist: {}
    }

    expect(passWhitelistApiKeys(storeSettings, '200.0.0.1'))
    expect(passWhitelistApiKeys(storeSettings, '404.0.0.1'))
  })
  it('Will pass specific API key with settings', () => {
    const storeSettings: StoreSettings = {
      ...defaultStoreSettings,
      apiKeyWhitelist: {
        secret1: true,
        secret2: true,
        secret3: true
      }
    }

    expect(passWhitelistApiKeys(storeSettings, 'secret1'))
    expect(passWhitelistApiKeys(storeSettings, 'secret2'))
    expect(passWhitelistApiKeys(storeSettings, 'secret3'))
    expect(!passWhitelistApiKeys(storeSettings, 'secret4'))
    expect(!passWhitelistApiKeys(storeSettings, 'secret5'))
  })
})
