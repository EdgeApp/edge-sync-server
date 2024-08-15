import {
  asArray,
  asCodec,
  asEither,
  asJSON,
  asNull,
  asNumber,
  asObject,
  asOptional,
  asString,
  asUnknown,
  Cleaner,
  uncleaner
} from 'cleaners'

export type JsonRpcId = string | number | null
export const asJsonRpcId: Cleaner<JsonRpcId> = asEither(
  asString,
  asNumber,
  asNull
)

/** A message is either a request or a response. */
export interface JsonRpcMessage {
  readonly id: JsonRpcId | null
  readonly method?: string
  readonly params?: unknown
  readonly error?: JsonRpcError
  readonly result?: unknown
}

export interface JsonRpcError {
  readonly code: number
  readonly message: string
  readonly data?: any
}

/** A method is a generator of `JsonRpcMessage` for on-going procedural calls */
export type JsonRpcStream = AsyncGenerator<JsonRpcMessage, void>

/**
 * A callet is an function that takes a {@link JsonRpcMessage} and returns
 * a {@link JsonRpcMessage} or {@link JsonRpcStream} (an async generator of
 * {@link JsonRpcMessage}).
 */
export declare type Callet<
  In = JsonRpcMessage,
  Out extends
    | JsonRpcMessage
    | undefined
    | Promise<JsonRpcMessage | undefined>
    | JsonRpcStream = JsonRpcStream
> = (message: In) => Out

//
// Cleaners
//

export const asJsonRpcError = asObject<JsonRpcError>({
  code: asNumber,
  message: asString,
  data: asOptional(asUnknown)
})
export const asJsonRpcMessage = asJSON(
  asCodec(
    asObject<JsonRpcMessage>({
      id: asJsonRpcId,
      error: asOptional(asJsonRpcError),
      method: asOptional(asString),
      params: asOptional(asEither(asArray(asUnknown), asObject(asUnknown))),
      result: asUnknown
    }),
    raw => {
      return { ...raw, jsonrpc: '2.0' }
    }
  )
)
export const wasJsonRpcMessage = uncleaner(asJsonRpcMessage)
