import { asEither, asMap, asNull } from 'cleaners'

import { asEdgeBox } from '../types'

export type FileChangeV2 = ReturnType<typeof asFileChangeV2>
export const asFileChangeV2 = asEither(asEdgeBox, asNull)

export type ChangeSetV2 = ReturnType<typeof asChangeSetV2>
export const asChangeSetV2 = asMap(asFileChangeV2)
