import type { IssueStatus } from './issue-store.ts'

export const DEFAULT_ISSUE_ROWS = 50
export const MAX_ISSUE_ROWS = 200

export interface IssueSummary {
  id: string
  fingerprint: string
  status: IssueStatus
  title: string
  errorType: string
  service: string
  events: number
  firstSeen: string
  lastSeen: string
  resolvedAt: string | null
  regressedAt: string | null
}

export interface IssuePage {
  issues: readonly IssueSummary[]
  nextCursor: string | null
}

export interface IssueQuery {
  projectId: string
  environmentId: string
  statuses?: readonly IssueStatus[]
  since?: Date
  until?: Date
  limit?: number
  cursor?: string | null
}

export interface IssueReader {
  list(query: IssueQuery): Promise<IssuePage>
}

export class IssueCursorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IssueCursorError'
  }
}

const ISSUE_ID = /^iss_[0-9A-HJKMNP-TV-Z]{26}$/

export function encodeIssueCursor(lastSeen: string, id: string): string {
  return `${lastSeen}|${id}`
}

export function decodeIssueCursor(cursor: string): { lastSeen: string; id: string } {
  const at = cursor.indexOf('|')
  if (at <= 0) {
    throw new IssueCursorError('This cursor is not one this API handed out.')
  }
  const lastSeen = cursor.slice(0, at)
  const id = cursor.slice(at + 1)
  if (!ISSUE_ID.test(id)) {
    throw new IssueCursorError('This cursor is not one this API handed out.')
  }
  if (Number.isNaN(Date.parse(lastSeen))) {
    throw new IssueCursorError('This cursor is not one this API handed out.')
  }
  return { lastSeen, id }
}
