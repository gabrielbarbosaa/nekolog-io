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

export interface ExportNotice {
  id: string
  format: ExportFormat
  cadence: ExportCadence | null
  rangeFrom: number
  rangeTo: number
  rowCount: number
  byteSize: number
  expiresAt: number
  locale: string
  email: string
}

export interface ExportStore {
  claim(limit: number, now: number): Promise<ReadonlyArray<PendingExport>>
  markReady(id: string, outcome: ExportOutcome, at: number): Promise<void>
  markFailed(id: string, reason: string, at: number): Promise<void>
  expire(now: number, limit: number): Promise<ReadonlyArray<string>>
  awaitingNotice(limit: number): Promise<ReadonlyArray<ExportNotice>>
  markNotified(id: string, at: number): Promise<void>
}

export const EXPORT_CADENCES = ['daily', 'weekly'] as const
export type ExportCadence = (typeof EXPORT_CADENCES)[number]

export interface DueSchedule {
  id: string
  projectId: string
  environmentId: string
  format: ExportFormat
  cadence: ExportCadence
  query: string
  createdBy: string | null
}

export interface ScheduledExport {
  scheduleId: string
  exportId: string
  rangeFrom: number
  rangeTo: number
  expiresAt: number
  stampedAt: number
}

export interface ExportScheduleStore {
  due(cadence: ExportCadence, boundary: number, limit: number): Promise<ReadonlyArray<DueSchedule>>
  enqueue(one: ScheduledExport): Promise<boolean>
}
