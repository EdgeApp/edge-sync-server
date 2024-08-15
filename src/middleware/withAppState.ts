import { Serverlet } from 'serverlet'

import { AppState } from '../server'

export interface AppStateRequest {
  readonly appState: AppState
}

export const withAppState = <In>(
  appState: AppState,
  server: Serverlet<In & AppStateRequest>
): Serverlet<In> => async request => await server({ ...request, appState })
