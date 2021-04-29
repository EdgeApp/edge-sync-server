import pino from 'pino'

export const logger = pino({
  enabled: process.env.NODE_ENV !== 'test'
})
