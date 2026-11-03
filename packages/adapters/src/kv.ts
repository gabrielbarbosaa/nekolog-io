export type KvNamespace = {
  get(key: string, type: 'text'): Promise<string | null>
  put(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}
