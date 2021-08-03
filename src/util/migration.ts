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
    await exec(`git clone --bare -q ${repoUrl} ${repoDir}`)
  } catch (error) {
    if (error.message.indexOf(`repository '${repoUrl}' not found`) !== -1) {
      throw new Error('Repo not found')
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
  ).then(results =>
    results
      .map(result => {
        if (result.status === 'fulfilled') return result.value
        if (result.reason.message !== 'Repo not found') throw result.reason
        return ''
      })
      .filter(repoDir => repoDir !== '')
  )

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
    return promise.then(() => abSync(a, b))
  }, Promise.resolve())

  // AB Sync all cloned repos by running the promise change
  await abSyncSeries

  // Create a non-bare repo copy of the working repo
  const finalRepoDir = workingRepoDir + '--final'
  await exec(`git clone -q ${workingRepoDir} ${finalRepoDir}`)

  // Cleanup all repo dirs besides the final one
  await Promise.all(
    [...repoDirs, workingRepoDir].map(repoDir => cleanupRepoDir(repoDir))
  )

  // Return finalRepoDir; it should be sync'd with all other repos
  return finalRepoDir
}

const abSync = async (a: string, b: string): Promise<void> => {
  await exec(`ab-sync ${a} ${b}`)
}

const cleanupRepoDir = async (repoDir: string): Promise<void> => {
  if (await pathExists(repoDir)) {
    await exec(`rm -rf ${repoDir}`)
  }
}

const getRepoLastCommitInfo = async (
  repoDir: string
): Promise<{ lastGitHash?: string; lastGitTime?: number }> => {
  const { stdout: commitCountStdout } = await exec(
    `git rev-list --all --count`,
    { encoding: 'utf-8', cwd: repoDir }
  )

  const commitCount = parseInt(commitCountStdout.trim())

  if (commitCount === 0) {
    return { lastGitHash: undefined, lastGitTime: undefined }
  }

  const { stdout } = await exec(`git show -s --format=%H,%ct`, {
    encoding: 'utf-8',
    cwd: repoDir
  })
  const [lastGitHash, lastCommitTimestamp] = stdout.replace('\n', '').split(',')

  // Convert unix timestamp from seconds to milliseconds
  const lastGitTime = parseInt(lastCommitTimestamp) * 1000

  return { lastGitHash, lastGitTime }
}

const getRepoFilePathsRecursively = async (
  repoDir: string
): Promise<string[]> => {
  const { stdout } = await exec(
    `find ${repoDir} -not -type d | { grep -v '/\\.git/' || true; }`
  )
  return stdout.split('\n').filter(path => path !== '')
}

export const migrateRepo = (appState: AppState) => async (
  syncKey: string
): Promise<void> => {
  const repoDir = await cloneRepoWithAbSync(appState)(syncKey)
  const repoId = syncKeyToRepoId(syncKey)

  try {
    const filePaths = await getRepoFilePathsRecursively(repoDir)
    const { lastGitHash, lastGitTime } = await getRepoLastCommitInfo(repoDir)

    // Create the change set by reading files in temporary migration dir
    const changeSet: ChangeSet = {}
    for (const filePath of filePaths) {
      const fileContent = await readFile(filePath, {
        encoding: 'utf-8'
      })
      const box = JSON.parse(fileContent)
      const fileChange = asFileChange(box)

      // Add 1 to substr "from" param to remove the leading forward slash
      const relativePath = filePath.substr(repoDir.length + 1)

      changeSet[relativePath] = fileChange
    }

    // Update database
    await withRetries(
      async (): Promise<void> => {
        const timestamp = lastGitTime ?? Date.now()

        // Update files and directories
        if (filePaths.length > 0) {
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
    await cleanupRepoDir(repoDir)
  }
}
