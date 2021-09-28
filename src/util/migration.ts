import { exec as execOriginal } from 'child_process'
import { asFileChange, ChangeSet } from 'edge-sync-client'
import { access, readFile } from 'fs/promises'
import { join } from 'path'
import { promisify } from 'util'

import { logger } from '../logger'
import { AppState } from '../server'
import { syncKeyToRepoId } from './security'
import { createRepoDocument } from './store/repo'
import { writeUpdates } from './store/syncing'
import { trial } from './trial'
import { withRetries } from './with-retries'

const exec = promisify(execOriginal)

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path)
  } catch (err) {
    return false
  }
  return true
}

// For security purposes, we must validate syncKey strings before using as input
// to exec. We use this validation funciton of asSyncKey because we don't care
// about length.
const validateSyncKey = (syncKey: string): void => {
  if (!/^[a-f0-9]+$/i.test(syncKey)) {
    throw new Error(`Invalid sync key '${syncKey}`)
  }
}

const cloneRepo = ({ config }: AppState) => async (
  originUrl: string,
  syncKey: string
): Promise<string> => {
  validateSyncKey(syncKey)

  const host = new URL(originUrl).host
  const repoUrl = `${originUrl}${syncKey}/`
  const randomStuff = Math.random().toString().split('.')[1]
  const repoDir = join(
    config.migrationTmpDir,
    `${syncKey}_${host}_${randomStuff}`
  )

  try {
    // absync expects repos to be bare
    await exec(`git clone --bare -q ${repoUrl} ${repoDir}`, {
      maxBuffer: config.migrationMaxBufferSize
    })
  } catch (error) {
    if (error.message.indexOf(`repository '${repoUrl}' not found`) !== -1) {
      throw new Error('Repo not found')
    }
    if (
      error.message.indexOf(`remote: fatal: bad tree object`) !== -1 ||
      error.message.indexOf(
        `remote: aborting due to possible repository corruption on the remote side`
      ) !== -1
    ) {
      const message: string = error.message
      throw new Error(`Repo corrupt: ${message}`)
    }
    throw error
  }

  return repoDir
}

const cloneRepoWithAbSync = (appState: AppState) => async (
  syncKey: string
): Promise<string> => {
  const repoDirs = await Promise.allSettled(
    appState.config.migrationOriginServers.map(url =>
      cloneRepo(appState)(url, syncKey)
    )
  ).then(results => {
    let corrupted = 0
    return results
      .map(result => {
        // Resolved
        if (result.status === 'fulfilled') return result.value

        // Rejected
        const { reason } = result
        // Its okay if a repo is not found on a particular git server
        if (reason.message === 'Repo not found') return ''
        // It's okay if the repo is corrupt so long as there are repos on
        // other servers which were not corrupt.
        if (
          reason.message.indexOf('Repo corrupt') !== -1 &&
          appState.config.migrationOriginServers.length - ++corrupted > 0
        ) {
          logger.warn(reason)
          return ''
        }
        // Otherwise, we have a problem
        throw reason
      })
      .filter(repoDir => repoDir !== '')
  })

  // Get the first repoDir
  const workingRepoDir = repoDirs.shift()

  // Assertion case: there must be repo dirs cloned
  if (workingRepoDir == null) {
    throw new Error('Repo not found')
  }

  // Create an array of dir tuples like [workingRepoDir, otherRepoDir], or more
  // specifically like [dir[0], dir[0 < n < dir.length]]
  const repoDirTuples = repoDirs.reduce<Array<[string, string]>>(
    (dirTuples, otherRepoDir) => [...dirTuples, [workingRepoDir, otherRepoDir]],
    []
  )

  // Build a promise chain from the dir tuples (serial operations)
  const abSyncSeries = repoDirTuples.reduce((promise, [a, b]) => {
    return promise.then(() =>
      abSync(a, b, appState.config.migrationMaxBufferSize)
    )
  }, Promise.resolve())

  // AB Sync all cloned repos by running the promise change
  await abSyncSeries

  // Create a non-bare repo copy of the working repo
  const finalRepoDir = workingRepoDir + '--final'
  await exec(`git clone -q ${workingRepoDir} ${finalRepoDir}`, {
    maxBuffer: appState.config.migrationMaxBufferSize
  })

  // Cleanup all repo dirs besides the final one
  await Promise.all(
    [...repoDirs, workingRepoDir].map(repoDir =>
      cleanupRepoDir(repoDir, appState.config.migrationMaxBufferSize)
    )
  )

  // Return finalRepoDir; it should be sync'd with all other repos
  return finalRepoDir
}

const abSync = async (
  a: string,
  b: string,
  maxBufferSize: number
): Promise<void> => {
  await exec(`ab-sync ${a} ${b}`, {
    maxBuffer: maxBufferSize
  })
}

const cleanupRepoDir = async (
  repoDir: string,
  maxBufferSize: number
): Promise<void> => {
  if (await pathExists(repoDir)) {
    await exec(`rm -rf ${repoDir}`, {
      maxBuffer: maxBufferSize
    })
  }
}

const getRepoLastCommitInfo = async (
  repoDir: string,
  maxBufferSize: number
): Promise<{ lastGitHash?: string; lastGitTime?: number }> => {
  const { stdout: commitCountStdout } = await exec(
    `git rev-list --all --count`,
    {
      encoding: 'utf-8',
      cwd: repoDir,
      maxBuffer: maxBufferSize
    }
  )

  const commitCount = parseInt(commitCountStdout.trim())

  if (commitCount === 0) {
    return { lastGitHash: undefined, lastGitTime: undefined }
  }

  const { stdout } = await exec(`git show -s --format=%H,%ct`, {
    encoding: 'utf-8',
    cwd: repoDir,
    maxBuffer: maxBufferSize
  })
  const [lastGitHash, lastCommitTimestamp] = stdout.replace('\n', '').split(',')

  // Convert unix timestamp from seconds to milliseconds
  const lastGitTime = parseInt(lastCommitTimestamp) * 1000

  return { lastGitHash, lastGitTime }
}

const getRepoFilePathsRecursively = async (
  repoDir: string,
  maxBufferSize: number
): Promise<string[]> => {
  const { stdout } = await exec(
    `find ${repoDir} -not -type d | { grep -v '/\\.git/' || true; }`,
    {
      maxBuffer: maxBufferSize
    }
  )
  return stdout.split('\n').filter(path => path !== '')
}

export const migrateRepo = (appState: AppState) => async (
  syncKey: string
): Promise<void> => {
  const repoDir = await cloneRepoWithAbSync(appState)(syncKey)
  const repoId = syncKeyToRepoId(syncKey)

  try {
    const filePaths = await getRepoFilePathsRecursively(
      repoDir,
      appState.config.migrationMaxBufferSize
    )
    const { lastGitHash, lastGitTime } = await getRepoLastCommitInfo(
      repoDir,
      appState.config.migrationMaxBufferSize
    )

    // Create the change set by reading files in temporary migration dir
    const changeSet: ChangeSet = {}
    for (const filePath of filePaths) {
      const fileContent = await readFile(filePath, {
        encoding: 'utf-8'
      })

      // Ignore empty files
      if (fileContent === '') continue

      const fileChange = trial(
        () => {
          const box = JSON.parse(fileContent)
          return asFileChange(box)
        },
        err => {
          const subErrorMessage = err instanceof Error ? `: ${err.message}` : ''
          logger.warn(
            new Error(`Failed to migrate file ${filePath}${subErrorMessage}`)
          )
          return null
        }
      )

      // Add 1 to substr "from" param to remove the leading forward slash
      const relativePath = filePath.substr(repoDir.length + 1)

      changeSet[relativePath] = fileChange
    }

    // Update database
    await withRetries(
      async (): Promise<void> => {
        const timestamp = lastGitTime ?? Date.now()

        // Update files and directories
        if (Object.keys(changeSet).length > 0) {
          await writeUpdates(appState)(repoId, changeSet)
        }

        // Create Repo Document (last db operation)
        try {
          await createRepoDocument(appState)(repoId, {
            timestamp,
            lastGitHash,
            lastGitTime
          })
        } catch (err) {
          // Silence conflict errors
          if (err.error === 'conflict') {
            logger.info(
              `Conflict migrating repo with repoId '${repoId}'. ` +
                `Migration was already completed by another process.`
            )
          } else {
            throw err
          }
        }
      },
      err => err.message === 'conflict'
    )
  } finally {
    // Cleanup temp migration dir
    await cleanupRepoDir(repoDir, appState.config.migrationMaxBufferSize)
  }
}
