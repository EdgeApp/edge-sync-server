import { asTimestampRev, TimestampRev } from '../../types'
import { SyncClient } from './SyncClient'
import { asCheckerInput, CheckerInput, CheckEvent } from './types'
import {
  delay,
  isAcceptableError,
  isRepoNotFoundError,
  send
} from './utils/utils'

process.title = 'checker'

// Main
async function main(serverUrls: string[], repoIds: string[]): Promise<void> {
  // State
  const syncClients: SyncClient[] = serverUrls.map(url => new SyncClient(url))

  statusCheckRoutine(syncClients, repoIds).catch(errHandler)
}

const statusCheckRoutine = (
  syncClients: SyncClient[],
  repoIds: string[]
): Promise<void> =>
  Promise.all(
    syncClients.flatMap(sync =>
      repoIds.map(repoId => checkServerStatus({ sync, repoId }))
    )
  )
    .then(checkResponses => {
      checkResponses.forEach(response => {
        if (response != null) {
          send(response)
        }
      })
    })
    .then(() => delay(500))
    .then(() => statusCheckRoutine(syncClients, repoIds))

interface CheckServerStatusProps {
  sync: SyncClient
  repoId: string
}

async function checkServerStatus({
  sync,
  repoId
}: CheckServerStatusProps): Promise<CheckEvent | undefined> {
  const requestTime = Date.now()

  try {
    const response = await sync.getUpdates(repoId)

    const serverRepoTimestamp: TimestampRev = response.data.timestamp

    return {
      type: 'check',
      serverHost: sync.host,
      repoId,
      requestTime,
      serverRepoTimestamp
    }
  } catch (error) {
    if (!isAcceptableError(error)) {
      throw error
    }

    if (isRepoNotFoundError(error)) {
      return {
        type: 'check',
        serverHost: sync.host,
        repoId,
        requestTime,
        serverRepoTimestamp: asTimestampRev(0)
      }
    }

    send(error)
  }
}

// Startup:

try {
  const jsonArg = process.argv[2]

  if (jsonArg == null) {
    throw new Error('Missing json argument.')
  }

  let input: CheckerInput

  try {
    input = asCheckerInput(JSON.parse(jsonArg))
  } catch (error) {
    if (error instanceof Error)
      throw new Error(`Invalid JSON input argument: ${error.message}`)
    throw error
  }

  main(input.serverUrls, input.repoIds).catch(errHandler)
} catch (error) {
  send(error)
}

process.on('unhandledRejection', error => {
  send(`UNHANDLED PROMISE!!!`)
  if (error instanceof Error) errHandler(error)
})

function errHandler(err: Error): void {
  send(err)
  process.exit(1)
}
