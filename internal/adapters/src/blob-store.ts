export interface BlobStore {
  put(key: string, body: Uint8Array | string, contentType?: string): Promise<void>
  get(key: string): Promise<Uint8Array | null>
  delete(key: string): Promise<void>
  list(prefix: string): Promise<ReadonlyArray<string>>
}
