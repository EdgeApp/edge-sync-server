import { DatabaseChangesResultItem } from 'nano'

import { AppState } from '../server'

export async function* makeCouchDbChangeStream(
  appState: AppState
): AsyncGenerator<DatabaseChangesResultItem> {
  const { storeDb } = appState

  const reader = storeDb.changesReader.start({
    includeDocs: false
  })

  const callbacks = new Set<(data: DatabaseChangesResultItem) => void>()

  reader.on('change', (data: DatabaseChangesResultItem) => {
    for (const callback of callbacks) {
      callback(data)
    }
  })

  try {
    while (true) {
      yield new Promise<DatabaseChangesResultItem>(resolve => {
        const callback = (data: DatabaseChangesResultItem): void => {
          resolve(data)
          callbacks.delete(callback)
        }
        callbacks.add(callback)
      })
    }
  } finally {
    for (const callback of callbacks) {
      reader.off('change', callback)
    }
    callbacks.clear()
  }
}
