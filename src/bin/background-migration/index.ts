#!/usr/bin/env node -r sucrase/register

import childProcess from 'child_process'
import { Cleaner } from 'cleaners'
import { appendFile, readFile, writeFile } from 'fs/promises'
import mkdirp from 'mkdirp'
import fetch, { Response } from 'node-fetch'
import { join } from 'path'
import { promisify } from 'util'

import { config } from './config'
import { asCheckpoint, asScanFile, Checkpoint, ScanFile } from './types'

const exec = promisify(childProcess.exec)

// Config
const {
  dataDir,
  sshHosts,
  remoteReposDir,
  syncServer,
  migrationEndpoint,
  concurrency
} = config

// ---------------------------------------------------------------------
// App
// ---------------------------------------------------------------------

async function main(): Promise<void> {
  await setup()

  // Get checkpoint
  let checkpoint: Checkpoint | null = await getCheckpoint()

  while (checkpoint !== null) {
    const partitionHex = checkpoint.partition.toString(16).padStart(2, '0')

    const scanFile = await getScanFile(partitionHex)
    const { syncKeys } = scanFile

    for (let index = checkpoint.index; index < syncKeys.length; ) {
      await Promise.all(
        syncKeys.slice(index, index + concurrency).map((syncKey, j) =>
          migrateRepo(syncKey)
            .then(async res => {
              const status = res.status
              const body = await res.json()

              if (status < 200 || status >= 300) {
                console.error(`${syncKey} ${status} response:`, body)
                await logFailedRepo(syncKey, { status, body })
              } else {
                console.log(
                  `Migrated ${syncKey} (partition ${partitionHex} at index ${
                    index + j
                  })`
                )
              }
            })
            .catch(async (error: Error) => {
              console.error(`${syncKey} failed:`, error)
              await logFailedRepo(syncKey, {
                error: { message: error.message, stack: error.stack }
              })
            })
        )
      )

      index += concurrency

      checkpoint = await updateCheckpoint({
        partition: checkpoint.partition,
        index
      })
    }

    const nextPartition: number = checkpoint.partition + 1
    if (nextPartition < 255) {
      checkpoint = await updateCheckpoint({
        partition: nextPartition,
        index: 0
      })
    } else {
      checkpoint = null
    }
  }
}

main().catch(criticalError)

function criticalError(err: any): void {
  console.error(err)
  process.exit(1)
}

async function setup(): Promise<void> {
  await mkdirp(dataDir)
}

// ---------------------------------------------------------------------
// Lib
// ---------------------------------------------------------------------

async function getCheckpoint(): Promise<Checkpoint> {
  const checkpointFileName = 'checkpoint.json'
  const checkpointFilePath = join(dataDir, checkpointFileName)

  const checkpoint = await getCleanFile(
    checkpointFilePath,
    asCheckpoint,
    async () => {
      return { partition: 0, index: 0 }
    }
  )

  return checkpoint
}

async function updateCheckpoint(checkpoint: Checkpoint): Promise<Checkpoint> {
  const checkpointFileName = 'checkpoint.json'
  const checkpointFilePath = join(dataDir, checkpointFileName)

  await writeFile(checkpointFilePath, JSON.stringify(checkpoint), 'utf8')

  return checkpoint
}

async function getScanFile(partitionHex: string): Promise<ScanFile> {
  const scanFileName = `${partitionHex}.json`
  const scanFilePath = join(dataDir, scanFileName)

  const scan = await getCleanFile(scanFilePath, asScanFile, () =>
    scanRemotesForScanFile(partitionHex)
  )

  return scan
}

async function scanRemotesForScanFile(partitionHex: string): Promise<ScanFile> {
  const syncKeyArrays = await Promise.all(
    sshHosts.map(sshHost =>
      lsRemote(sshHost, join(remoteReposDir, partitionHex))
    )
  )
  const syncKeys = mergeArrays(...syncKeyArrays)

  return { partitionHex, syncKeys }
}

function mergeArrays<T>(...arrays: T[][]): T[] {
  return Array.from(new Set(arrays.flat()))
}

async function lsRemote(sshHost: string, dir: string): Promise<string[]> {
  console.info(`Reading ${dir} at ${sshHost}`)
  const { stdout } = await exec(`ssh ${sshHost} 'ls ${dir}'`)
  const entries = stdout.trim().split('\n')

  return entries
}

async function getCleanFile<T>(
  path: string,
  cleaner: Cleaner<T>,
  fallback: () => Promise<T>
): Promise<T> {
  let rtn: T
  try {
    const content = await readFile(path, 'utf8')
    rtn = cleaner(JSON.parse(content))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    rtn = await fallback()
    await writeFile(path, JSON.stringify(rtn), 'utf8')
  }

  return rtn
}

async function migrateRepo(syncKey: string): Promise<Response> {
  const response = await fetch(
    `${syncServer}${migrationEndpoint.replace(':syncKey', syncKey)}`
  )

  return response
}

async function logFailedRepo(syncKey: string, reason: any): Promise<void> {
  await appendFile(
    join(dataDir, 'failed-repos.log'),
    JSON.stringify({ syncKey, timestamp: Date.now(), reason }) + '\n'
  )
}
