import * as Nano from 'nano'

export interface StoreRoot extends Nano.MaybeDocument {
  files: StoreFileMap
  timestamp: number
  lastGitHash?: string
  lastGitTime?: number
  size: number
  sizeLastCreated: number
  maxSize: number
}

export interface StoreFileMap {
  [path: string]: number | null
}

export interface DocumentRequest {
  [Key: string]: number
}

export interface Results {
  [Key: string]: StoreDocument
}

export interface StoreDocument {
  timestamp: number
  files?: object
  content?: string
}

export type DbResponse = Nano.DocumentGetResponse & StoreDocument

export interface File {
  timestamp: number
  content: string
}

export interface ApiResponse<Data> {
  success: true
  data: Data
}
export interface ApiErrorResponse {
  success: false
  message: string
}
