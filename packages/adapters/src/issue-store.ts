export const ISSUE_STATUSES = ['open', 'resolved', 'ignored'] as const

export type IssueStatus = (typeof ISSUE_STATUSES)[number]

export interface IssueOccurrence {
  projectId: string
  environmentId: string
  fingerprint: string
  events: number
  firstSeen: number
  lastSeen: number
  level: string
  errorType: string
  title: string
  service: string
  release: string
}

export interface IssueRollup {
  created: number
  updated: number
  reopened: number
}

export interface IssueStore {
  record(occurrences: ReadonlyArray<IssueOccurrence>): Promise<IssueRollup>
}
