import bs58 from 'bs58'
import { createHash } from 'crypto'
import express from 'express'
import {
  CustomRequestSerializer,
  CustomResponseSerializer
} from 'pino-std-serializers'

const SENSITIVE_URL_REGEX = /(?<before>^\/api\/v2\/store\/)(?<syncKey>[^/]*)(?<after>.*)$/

export const syncKeyToRepoId = (syncKey: string): string => {
  const bytes = Buffer.from(syncKey, 'hex')
  const hashBytes = sha256(sha256(bytes))
  return bs58.encode(hashBytes)
}

const sha256 = (input: Uint8Array): Uint8Array => {
  const hash = createHash('sha256')
  hash.update(input)
  return hash.digest()
}

/**
 * Desensitize request object for HTTP logging.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export const numbRequest: CustomRequestSerializer = req => {
  const { url, repoId } = numbEndpoint(req.url)
  const { params, query } = req.raw as express.Request

  return {
    id: req.id,
    method: req.method,
    url,
    params,
    query,
    remoteAddress: req.remoteAddress,
    remotePort: req.remotePort,
    repoId
  }
}

/**
 * Desensitize request object for HTTP logging.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export const numbResponse: CustomResponseSerializer = res => {
  return {
    statusCode: res.statusCode
  }
}

/**
 * Desensitize request URL endpoints.
 * Remove sensative information; i.e. syncKey.
 */
export const numbEndpoint = (url: string): { url: string; repoId?: string } => {
  const matches = url.match(SENSITIVE_URL_REGEX)
  const syncKey = matches != null ? matches.groups?.syncKey : undefined
  const repoId = syncKey != null ? syncKeyToRepoId(syncKey) : undefined
  const numbedUrl = url.replace(SENSITIVE_URL_REGEX, '$<before>***$<after>')

  return { url: numbedUrl, repoId }
}
