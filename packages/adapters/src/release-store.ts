export const MAX_VERSION_CHARS = 200
export const COMMIT_PATTERN: RegExp = /^[0-9a-f]{7,40}$/

export interface ReleaseInput {
  projectId: string
  environmentId: string
  version: string
  commit?: string | null
  releasedAt?: Date
}

export interface Release {
  id: string
  projectId: string
  environmentId: string
  version: string
  commit: string | null
  sourcemapCount: number
  releasedAt: string
  createdAt: string
}

export interface RecordedRelease {
  release: Release
  created: boolean
}

export interface ReleaseStore {
  record(input: ReleaseInput): Promise<RecordedRelease>
}

export class InvalidRelease extends Error {
  readonly field: string

  constructor(field: string, message: string) {
    super(message)
    this.name = 'InvalidRelease'
    this.field = field
  }
}

export function assertVersion(value: unknown): string {
  if (typeof value !== 'string') {
    throw new InvalidRelease('version', 'A release needs a version, as a string.')
  }
  if (value !== value.trim()) {
    throw new InvalidRelease('version', 'A version may not begin or end with whitespace.')
  }
  if (value === '' || value.length > MAX_VERSION_CHARS) {
    throw new InvalidRelease(
      'version',
      `A version is between 1 and ${MAX_VERSION_CHARS} characters.`,
    )
  }
  return value
}

export function assertCommit(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null
  }
  if (typeof value !== 'string' || !COMMIT_PATTERN.test(value)) {
    throw new InvalidRelease(
      'commit',
      'A commit is 7 to 40 lowercase hexadecimal characters, or nothing at all.',
    )
  }
  return value
}

export function assertReleasedAt(value: Date | undefined, now: number): Date {
  if (value === undefined) {
    return new Date(now)
  }
  if (Number.isNaN(value.getTime())) {
    throw new InvalidRelease('releasedAt', 'That is not a moment.')
  }
  return value
}
