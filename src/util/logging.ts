import { ChangeSet } from 'edge-sync-client'
import { Logger } from 'pino'

interface ChangeSummary {
  [key: string]: string | null
}

/**
 * Logs a ChangeSummary from a ChangeSet.
 */
export const logChangeSummary = (log: Logger, changes: ChangeSet): void => {
  const changeSummary: ChangeSummary = {}
  for (const [key, value] of Object.entries(changes)) {
    changeSummary[key] =
      value?.data_base64.slice(0, Math.min(8, value?.data_base64.length)) ??
      null
  }
  log.info({ msg: 'change summary', changeSummary })
}
