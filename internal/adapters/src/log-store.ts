export interface LogStoreInsertResult {
  accepted: number
}

export interface LogStore {
  insert(events: ReadonlyArray<Record<string, unknown>>): Promise<LogStoreInsertResult>
}
