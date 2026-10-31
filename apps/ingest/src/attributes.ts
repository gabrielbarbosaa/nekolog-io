export const MAX_ATTRIBUTE_KEYS_PER_PROJECT = 500
export const MAX_TRACKED_PROJECTS = 50

export type AttributeBudget = {
  admit(projectId: string, key: string): boolean
  known(projectId: string): number
  readonly dropped: number
}

export type AttributeBudgetOptions = {
  maxKeysPerProject?: number
  maxProjects?: number
}

export function createAttributeBudget(options: AttributeBudgetOptions = {}): AttributeBudget {
  const maxKeysPerProject = options.maxKeysPerProject ?? MAX_ATTRIBUTE_KEYS_PER_PROJECT
  const maxProjects = options.maxProjects ?? MAX_TRACKED_PROJECTS
  if (!Number.isInteger(maxProjects) || maxProjects < 1) {
    throw new Error(`An attribute budget has to track at least one project, got ${maxProjects}`)
  }
  const seen = new Map<string, Set<string>>()
  let dropped = 0

  const setFor = (projectId: string): Set<string> => {
    const existing = seen.get(projectId)
    if (existing !== undefined) {
      return existing
    }

    const fresh = new Set<string>()
    seen.set(projectId, fresh)
    while (seen.size > maxProjects) {
      const oldest = seen.keys().next()
      if (oldest.done) {
        break
      }
      seen.delete(oldest.value)
    }
    return fresh
  }

  return {
    admit(projectId, key) {
      const keys = setFor(projectId)
      if (keys.has(key)) {
        return true
      }
      if (keys.size >= maxKeysPerProject) {
        dropped += 1
        return false
      }
      keys.add(key)
      return true
    },

    known(projectId) {
      return seen.get(projectId)?.size ?? 0
    },

    get dropped() {
      return dropped
    },
  }
}
