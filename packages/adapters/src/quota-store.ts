export interface QuotaBlock {
  environmentId: string
  blockedAt: number
  events: number
  quota: number
}

export interface QuotaStore {
  blocked(): Promise<ReadonlyArray<QuotaBlock>>
  replace(blocks: ReadonlyArray<QuotaBlock>): Promise<void>
}
