import { Callet, JsonRpcMessage, JsonRpcStream } from '../lib/callet'

export function withJsonRpcMethod<In extends JsonRpcMessage>(
  methods: { [method: string]: Callet<In> },
  fallback: Callet<In> = defaultFallback
): Callet<In> {
  const table: Array<{
    method: string
    server: Callet<In>
  }> = []
  for (const method of Object.keys(methods)) {
    table.push({
      method: method,
      server: methods[method]
    })
  }

  return async function* (message: In): any /* silence type-checker */ {
    const request = ('method' in message
      ? message
      : null) as JsonRpcMessage | null
    if (request == null) return
    for (const { method, server } of table) {
      if (method === request.method) {
        const generator = await server(message)
        for await (const response of generator) {
          yield response
        }
        return
      }
    }

    // Fallback:
    const generator = await fallback(message)
    for await (const response of generator) {
      yield response
    }
  }
}

// We have to use `as any` when applying this fallback generator to
// `withJsonRpcMethods` because otherwise TypeScript complains about subtypes.
async function* defaultFallback(message: JsonRpcMessage): JsonRpcStream {
  yield {
    id: message.id,
    error: {
      code: 0,
      message: 'Method not found'
    }
  }
}
