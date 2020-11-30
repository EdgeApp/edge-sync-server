import { asEither, asMap, asNull, asString } from 'cleaners'

export type ChangeSet = ReturnType<typeof asChangeSet>

export const asChangeSet = asMap(
  asEither(asEither(asObjectType, asString), asNull)
)

function asObjectType(raw: any): object {
  if (typeof raw === 'object') {
    return raw
  } else {
    throw TypeError('Expected object type')
  }
}
