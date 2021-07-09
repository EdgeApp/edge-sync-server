import { asObject, asString } from 'cleaners'

export interface ErrorObj extends Error {
  [key: string]: any
}
export const asErrorObj = (raw: any): ErrorObj => {
  const clean = asObject({
    name: asString,
    message: asString,
    stack: asString
  }).withRest(raw)
  const out: ErrorObj = new Error(clean.message)
  out.message = clean.message
  out.stack = clean.stack
  out.name = clean.name
  Object.entries(clean).forEach(function ([key, value]) {
    out[key] = value
  })
  return out
}
