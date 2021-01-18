import { exec as execOriginal } from 'child_process'
import { access, readFile } from 'fs/promises'
import { join } from 'path'
import { promisify } from 'util'

import { AppState } from '../server'
import { asFileChange, ChangeSet, StoreFileTimestampMap } from '../types'
import { withRetries } from '../util/utils'
import { createRepoDocument } from './repo'
import { updateFilesAndDirectories } from './updateFiles'

const exec = promisify(execOriginal)

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path)
  } catch (err) {
    return false
  }
  return true
}

// For security purposes, we must validate repoId strings before using as input
// to exec.
const validateRepoId = (repoId: string): void => {
  if (!/^[a-f0-9]+$/i.test(repoId)) {
    throw new Error(`Invalid repoId '${repoId}`)
  }
}

const cloneRepo = ({ config }: AppState) => async (
  repoId: string
): Promise<string> => {
  validateRepoId(repoId)

  const repoUrl = `${config.migrationOriginServer}${repoId}/`
  const repoDir = join(
    config.migrationTmpDir,
    `${repoId}-${Math.random().toString().split('.')[1]}`
  )

  try {
    await exec(`git clone -q --depth 1 ${repoUrl} ${repoDir}`)
  } catch (error) {
    if (error.message.indexOf(`repository '${repoUrl}' not found`) !== -1) {
      throw new Error('Repo not found')
    }
    throw error
  }

  return repoDir
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
    `find ${repoDir} -not -type d | { grep -v '.git' || true; }`
  )
  return stdout.split('\n').filter(path => path !== '')
}

export const migrateRepo = (appState: AppState) => async (
  repoId: string
): Promise<void> => {
  const repoDir = await cloneRepo(appState)(repoId)

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
      const fileChange = asFileChange({
        box
      })

      const relativePath = filePath.substr(repoDir.length)

      changeSet[relativePath] = fileChange
    }

    // Update database
    await withRetries(
      async (): Promise<void> => {
        const timestamp = lastGitTime ?? Date.now()

        let paths: StoreFileTimestampMap = {}

        // Update files and directories
        if (filePaths.length > 0) {
          const repoModification = await updateFilesAndDirectories(appState)(
            repoId,
            changeSet,
            timestamp
          )
          paths = repoModification.paths
        }

        // Create Repo Document (last db operation)
        try {
          await createRepoDocument(appState)(repoId, {
            paths,
            timestamp,
            lastGitHash,
            lastGitTime
          })
        } catch (err) {
          // Silence conflict errors
          if (err.error === 'conflict') {
            console.log(
              `Conflict migrating repo ID ${repoId}. ` +
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
