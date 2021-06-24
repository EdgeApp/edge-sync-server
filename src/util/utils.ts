/**
 * Wraps a function and invokes the function with rety attemps if error passes
 * a condition function.
 *
 * @param fn An async funciton to invoke with retry attempts
 * @param condition A function that returns a boolean given the error thrown
 * @param maxRetries Max number of retries (default 100)
 */
export const withRetries = async <T>(
  fn: () => Promise<T>,
  condition: (err: any) => boolean,
  maxRetries: number = 100
): Promise<T> => {
  let result: T
  let retries: number = 0

  while (true) {
    try {
      result = await fn()
    } catch (err) {
      if (condition(err) && retries !== maxRetries) {
        retries += 1
        continue
      }
      throw err
    }

    break
  }

  return result
}

export const delay = (ms: number): Promise<void> => {
  return new Promise((resolve, reject) => setTimeout(resolve, ms))
}
