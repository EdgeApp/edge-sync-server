import { Logger } from 'pino'
import PinoHttp from 'pino-http'
import { Serverlet } from 'serverlet'

export interface PinoRequest {
  id: PinoHttp.ReqId
  log: Logger
}

export const withPino = <T>(
  logger: Logger,
  server: Serverlet<T & PinoRequest>
): Serverlet<T> => async request =>
  await server({
    ...request,
    log: logger,
    id: genReqId()
  })

// Custom generator for request IDs (taken from pino-http implementation)
const maxInt = 2147483647
let nextReqId = 0
export const genReqId = (): PinoHttp.ReqId => {
  return (nextReqId = (nextReqId + 1) & maxInt)
}
