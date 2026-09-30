import WebSocket from 'ws'

export interface RpcNotification {
  method: string
  params: any
}

export interface TestWsClient {
  ws: WebSocket
  /** Resolves with the whole response message (result or error). */
  call: (method: string, params: unknown) => Promise<any>
  sendRaw: (text: string) => void
  /** Every notification received so far, oldest first. */
  notifications: RpcNotification[]
  /** Every message received that had an id of null (such as parse errors). */
  orphans: any[]
  /** Resolves with the next notification, or rejects after `timeoutMs`. */
  nextNotification: (timeoutMs?: number) => Promise<RpcNotification>
  close: () => Promise<void>
}

export const connectWs = async (url: string): Promise<TestWsClient> => {
  const ws = new WebSocket(url)
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve())
    ws.once('error', reject)
    ws.once('unexpected-response', (_req, res) =>
      reject(new Error(`Unexpected response ${String(res.statusCode)}`))
    )
  })

  let nextId = 1
  const pending = new Map<number, (message: any) => void>()
  const notifications: RpcNotification[] = []
  const orphans: any[] = []
  let waiter: ((n: RpcNotification) => void) | undefined
  let read = 0

  ws.on('message', data => {
    const message = JSON.parse((data as Buffer).toString())
    if (typeof message.id === 'number') {
      pending.get(message.id)?.(message)
      pending.delete(message.id)
    } else if (message.method != null) {
      notifications.push({ method: message.method, params: message.params })
      if (waiter != null) {
        const w = waiter
        waiter = undefined
        w(notifications[read++])
      }
    } else {
      orphans.push(message)
    }
  })

  return {
    ws,
    notifications,
    orphans,
    async call(method, params) {
      const id = nextId++
      const reply = new Promise(resolve => pending.set(id, resolve))
      ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
      return await reply
    },
    sendRaw(text) {
      ws.send(text)
    },
    async nextNotification(timeoutMs = 3000) {
      if (read < notifications.length) return notifications[read++]
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiter = undefined
          reject(new Error('No notification arrived'))
        }, timeoutMs)
        waiter = n => {
          clearTimeout(timer)
          resolve(n)
        }
      })
    },
    async close() {
      if (ws.readyState === WebSocket.CLOSED) return
      await new Promise<void>(resolve => {
        ws.once('close', () => resolve())
        ws.close()
      })
    }
  }
}
