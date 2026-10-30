export interface KeyRecord {
  projectId: string
  environmentId: string
  scopes: ReadonlyArray<'logs:write' | 'logs:read'>
  originAllowlist: ReadonlyArray<string> | null
  blocked: boolean
}

export interface KeyStore {
  get(keyHash: string): Promise<KeyRecord | null>
  set(keyHash: string, record: KeyRecord): Promise<void>
  delete(keyHash: string): Promise<void>
}
