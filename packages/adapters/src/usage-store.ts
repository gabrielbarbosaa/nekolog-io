export interface EnvironmentUsage {
  environmentId: string
  events: number
}

export interface UsageStore {
  eventsSince(startMs: number): Promise<ReadonlyArray<EnvironmentUsage>>
}
