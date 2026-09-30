/**
 * Wraps an async function so at most `limit` calls run at once; the rest
 * wait in arrival order.
 */
export const limitConcurrency = <A extends unknown[], R>(
  limit: number,
  fn: (...args: A) => Promise<R>
): ((...args: A) => Promise<R>) => {
  let active = 0
  const queue: Array<() => void> = []

  const release = (): void => {
    active -= 1
    const next = queue.shift()
    if (next != null) next()
  }

  return async (...args) => {
    if (active >= limit) {
      await new Promise<void>(resolve => queue.push(resolve))
    }
    active += 1
    try {
      return await fn(...args)
    } finally {
      release()
    }
  }
}
