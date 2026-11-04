import type { IssueOccurrence, IssueRollup, IssueStatus, IssueStore } from '../issue-store.ts'

export type MemoryIssue = {
  projectId: string
  fingerprint: string
  status: IssueStatus
  title: string
  errorType: string
  service: string
  events: number
  firstSeen: number
  lastSeen: number
  resolvedAt: number | undefined
  regressedAt: number | undefined
  byEnvironment: Map<string, { events: number; firstSeen: number; lastSeen: number }>
}

export type MemoryIssueStore = IssueStore & {
  issues(): MemoryIssue[]
  resolve(projectId: string, fingerprint: string, at: number): void
  ignore(projectId: string, fingerprint: string): void
}

function keyOf(projectId: string, fingerprint: string): string {
  return `${projectId}\u0000${fingerprint}`
}

export function memoryIssueStore(): MemoryIssueStore {
  const issues = new Map<string, MemoryIssue>()

  return {
    async record(occurrences: ReadonlyArray<IssueOccurrence>): Promise<IssueRollup> {
      const rollup: IssueRollup = { created: 0, updated: 0, reopened: 0 }

      for (const one of occurrences) {
        const key = keyOf(one.projectId, one.fingerprint)
        const found = issues.get(key)

        if (found === undefined) {
          issues.set(key, {
            projectId: one.projectId,
            fingerprint: one.fingerprint,
            status: 'open',
            title: one.title,
            errorType: one.errorType,
            service: one.service,
            events: one.events,
            firstSeen: one.firstSeen,
            lastSeen: one.lastSeen,
            resolvedAt: undefined,
            regressedAt: undefined,
            byEnvironment: new Map([
              [
                one.environmentId,
                { events: one.events, firstSeen: one.firstSeen, lastSeen: one.lastSeen },
              ],
            ]),
          })
          rollup.created += 1
          continue
        }

        found.events += one.events
        found.firstSeen = Math.min(found.firstSeen, one.firstSeen)
        found.lastSeen = Math.max(found.lastSeen, one.lastSeen)
        found.title = one.title
        found.errorType = one.errorType
        found.service = one.service

        const seen = found.byEnvironment.get(one.environmentId)
        if (seen === undefined) {
          found.byEnvironment.set(one.environmentId, {
            events: one.events,
            firstSeen: one.firstSeen,
            lastSeen: one.lastSeen,
          })
        } else {
          seen.events += one.events
          seen.firstSeen = Math.min(seen.firstSeen, one.firstSeen)
          seen.lastSeen = Math.max(seen.lastSeen, one.lastSeen)
        }

        if (
          found.status === 'resolved' &&
          found.resolvedAt !== undefined &&
          one.lastSeen > found.resolvedAt
        ) {
          found.status = 'open'
          found.regressedAt = one.lastSeen
          rollup.reopened += 1
        }

        rollup.updated += 1
      }

      return rollup
    },

    issues(): MemoryIssue[] {
      return [...issues.values()]
    },

    resolve(projectId: string, fingerprint: string, at: number): void {
      const found = issues.get(keyOf(projectId, fingerprint))
      if (found !== undefined) {
        found.status = 'resolved'
        found.resolvedAt = at
      }
    },

    ignore(projectId: string, fingerprint: string): void {
      const found = issues.get(keyOf(projectId, fingerprint))
      if (found !== undefined) {
        found.status = 'ignored'
      }
    },
  }
}
