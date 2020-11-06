import * as Nano from 'nano'

export interface StoreRoot extends Nano.MaybeDocument {
  files: object
  timestamp: number
  lastGitHash?: string
  lastGitTime?: number
  size: number
  sizeLastCreated: number
  maxSize: number
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

export interface ApiResponse {
  success: boolean
  data?: object
  message?: string
}
