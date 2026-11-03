export interface LogStoreInsertResult {
  accepted: number
}

export interface LogStoreInsertOptions {
  deduplicationToken?: string
}

export interface LogStore {
  insert(
    events: ReadonlyArray<Record<string, unknown>>,
    options?: LogStoreInsertOptions,
  ): Promise<LogStoreInsertResult>
}
