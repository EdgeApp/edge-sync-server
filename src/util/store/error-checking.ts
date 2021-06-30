import { DocumentBulkResponse } from 'nano'

/**
 * This checks for conflicts and errors in the store database write results
 */
export const checkDbResponseForErrors = (
  results: DocumentBulkResponse[]
): void => {
  return results.forEach(result => {
    if (result.error !== '' && result.error !== undefined) {
      if (result.error === 'conflict') {
        // For conflict errors, throw specific error message
        throw new Error(result.error)
      } else {
        const reason = result.reason
        // For all other errors, throw because it's unexpected
        throw new Error(
          'Unexpected database error' +
            (reason !== '' && reason !== undefined ? ': ' + reason : '')
        )
      }
    }
  })
}
