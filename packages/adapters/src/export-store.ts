export const EXPORT_FORMATS = ['json', 'xml', 'csv'] as const
export const EXPORT_STATUSES = ['pending', 'running', 'ready', 'failed', 'expired'] as const

export type ExportFormat = (typeof EXPORT_FORMATS)[number]
export type ExportStatus = (typeof EXPORT_STATUSES)[number]

export const EXPORT_LIFETIME_DAYS = 7

export interface PendingExport {
  id: string
  projectId: string
  environmentId: string
  format: ExportFormat
  query: string
  rangeFrom: number
  rangeTo: number
}

export interface ExportOutcome {
  objectKey: string
  byteSize: number
  rowCount: number
}

export interface ExportStore {
  claim(limit: number, now: number): Promise<ReadonlyArray<PendingExport>>
  markReady(id: string, outcome: ExportOutcome, at: number): Promise<void>
  markFailed(id: string, reason: string, at: number): Promise<void>
  expire(now: number, limit: number): Promise<ReadonlyArray<string>>
}
