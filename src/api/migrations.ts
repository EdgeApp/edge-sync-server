import { exec as execOriginal } from 'child_process'
import { access, readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { promisify } from 'util'

import { config } from '../config'
import { asFileChange, ChangeSet } from '../types'
import { withRetries } from '../utils'
import { createRepoDocument } from './repo'
import { updateFilesAndDirectories } from './updateFiles'

const omittedEntryNames = ['.', '..', '.git']

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

export const cloneRepo = async (repoId: string): Promise<string> => {
  validateRepoId(repoId)

  const repoUrl = `${config.migrationOriginServer}${repoId}/`
  const repoDir = join(
    config.migrationTmpDir,
    `${repoId}-${
      Math.random()
        .toString()
        .split('.')[1]
    }`
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

export const getRepoLastCommitInfo = async (
  repoDir: string
): Promise<{ lastGitHash: string; lastGitTime: number }> => {
  const { stdout } = await exec(`git show -s --format=%H,%ct`, {
    encoding: 'utf-8',
    cwd: repoDir
  })
  const [lastGitHash, lastCommitTimestamp] = stdout.replace('\n', '').split(',')

  // Convert unix timestamp from seconds to milliseconds
  const lastGitTime = parseInt(lastCommitTimestamp) * 1000

  return { lastGitHash, lastGitTime }
}

export const getRepoFilePathsRecursively = async (
  repoDir: string,
  parentDir: string = '/'
): Promise<string[]> => {
  let fileNames: string[] = []

  const entries = await readdir(join(repoDir, parentDir), {
    withFileTypes: true
  })

  for (const entry of entries) {
    const entryName = entry.name

    // Don't include from the omitted list
    if (omittedEntryNames.includes(entryName)) {
      continue
    }

    // Use recursion on directory entries
    if (entry.isDirectory() === true) {
      const subDirectory = join(parentDir, entryName)
      const subDirectoryFileNames = await getRepoFilePathsRecursively(
        repoDir,
        join(parentDir, entryName)
      ).then(fileNames =>
        fileNames.map(fileName => join(subDirectory, fileName))
      )

      fileNames = [...fileNames, ...subDirectoryFileNames]
      continue
    }

    // Add entry name because it's a file (prefix with /)
    fileNames.push('/' + entryName)
  }

  return fileNames
}

export const migrateRepo = async (repoId: string): Promise<void> => {
  const changeSet: ChangeSet = {}

  const repoDir = await cloneRepo(repoId)
  const filePaths = await getRepoFilePathsRecursively(repoDir)
  const { lastGitHash, lastGitTime } = await getRepoLastCommitInfo(repoDir)

  // Create the change set
  for (const filePath of filePaths) {
    const fileContent = await readFile(join(repoDir, filePath), {
      encoding: 'utf-8'
    })
    const box = JSON.parse(fileContent)
    const fileChange = asFileChange({
      box
    })

    changeSet[filePath] = fileChange
  }

  await withRetries(
    async (): Promise<void> => {
      // Update files and directories
      const repoModification = await updateFilesAndDirectories(
        repoId,
        changeSet,
        lastGitTime
      )

      // Create Repo Document (last db operation)
      await createRepoDocument(repoId, {
        paths: repoModification.paths,
        timestamp: lastGitTime,
        lastGitHash,
        lastGitTime: lastGitTime
      })

      // Migration cleanup
      await cleanupRepoDir(repoDir)
    },
    err => err.message === 'conflict'
  )
}
