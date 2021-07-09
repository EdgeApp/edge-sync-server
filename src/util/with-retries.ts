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
  condition: (err: any, tries: number) => boolean,
  maxRetries: number = 100
): Promise<T> => {
  let result: T
  let retries: number = 0

  while (true) {
    try {
      result = await fn()
    } catch (err) {
      if (retries !== maxRetries && condition(err, ++retries)) {
        continue
      }
      throw err
    }

    break
  }

  return result
}
