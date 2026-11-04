export const DEFAULT_API_URL = 'https://api.nekolog.io'
export const RELEASES_PATH = '/v1/releases'
export const SECRET_KEY_PREFIX = 'nekolog_sk_'
export const PUBLIC_KEY_PREFIX = 'nekolog_pk_'
export const COMMIT_PATTERN: RegExp = /^[0-9a-f]{7,40}$/
export const MAX_VERSION_CHARS = 200
export const LOOPBACK_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]', '::1']

export class ReleaseRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReleaseRefused'
  }
}

export type ReleaseOptions = {
  key?: string | undefined
  version?: string | undefined
  commit?: string | undefined
  releasedAt?: string | undefined
  apiUrl?: string | undefined
  fetch?: typeof fetch
}

export type RecordedRelease = {
  created: boolean
  release: {
    id: string
    version: string
    commit: string | null
    environmentId: string
    releasedAt: string
    sourcemapCount: number
  }
}

export function assertSecretKey(raw: string | undefined): string {
  const key = (raw ?? '').trim()
  if (key === '') {
    throw new ReleaseRefused(
      'I need a key. Pass --key or set NEKOLOG_KEY to the secret key of the environment.',
    )
  }
  if (key.startsWith(PUBLIC_KEY_PREFIX)) {
    throw new ReleaseRefused(
      'That is a public key. It ships in every browser bundle, so it may not record a release — use the secret key.',
    )
  }
  if (!key.startsWith(SECRET_KEY_PREFIX)) {
    throw new ReleaseRefused(
      `That does not look like a NekoLog key: it starts ${key.slice(0, 11)}…`,
    )
  }
  return key
}

export function assertReleaseVersion(raw: string | undefined): string {
  const version = raw ?? ''
  if (version === '') {
    throw new ReleaseRefused('I need a version: nekolog releases create <version>')
  }
  if (version !== version.trim()) {
    throw new ReleaseRefused('A version may not begin or end with whitespace.')
  }
  if (version.length > MAX_VERSION_CHARS) {
    throw new ReleaseRefused(`A version is at most ${MAX_VERSION_CHARS} characters.`)
  }
  return version
}

export function assertReleaseCommit(raw: string | undefined): string | null {
  if (raw === undefined || raw === '') {
    return null
  }
  if (!COMMIT_PATTERN.test(raw)) {
    throw new ReleaseRefused(
      'A commit is 7 to 40 lowercase hexadecimal characters. Try `git rev-parse HEAD`.',
    )
  }
  return raw
}

export function assertApiUrl(raw: string | undefined): URL {
  let url: URL
  try {
    url = new URL(raw ?? DEFAULT_API_URL)
  } catch {
    throw new ReleaseRefused(`${JSON.stringify(raw)} is not a URL.`)
  }

  if (url.username !== '' || url.password !== '') {
    throw new ReleaseRefused('Put the key in --key, not in the URL.')
  }
  if (url.protocol === 'https:') {
    return url
  }
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname)) {
    return url
  }
  throw new ReleaseRefused(
    `A secret key would travel in the clear to ${url.host}. Use https, or put a reverse proxy with a certificate in front of your self-host.`,
  )
}

export function releaseRequest(options: ReleaseOptions): Request {
  const key = assertSecretKey(options.key)
  const version = assertReleaseVersion(options.version)
  const commit = assertReleaseCommit(options.commit)
  const base = assertApiUrl(options.apiUrl)

  const body: Record<string, unknown> = { version }
  if (commit !== null) {
    body.commit = commit
  }
  if (options.releasedAt !== undefined && options.releasedAt !== '') {
    body.releasedAt = options.releasedAt
  }

  return new Request(new URL(RELEASES_PATH, base), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function refusalIn(text: string): { code?: string; message?: string } | null {
  try {
    const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } }
    return parsed.error ?? null
  } catch {
    return null
  }
}

export function reasonFrom(status: number, text: string): string {
  const refusal = refusalIn(text)
  if (refusal?.message) {
    return `${refusal.code ?? String(status)}: ${refusal.message}`
  }
  return `HTTP ${status}`
}

export async function createRelease(options: ReleaseOptions): Promise<RecordedRelease> {
  const request = releaseRequest(options)
  const send = options.fetch ?? fetch

  let response: Response
  try {
    response = await send(request)
  } catch (error) {
    throw new ReleaseRefused(
      `I could not reach ${new URL(request.url).host}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const text = await response.text()
  if (!response.ok) {
    throw new ReleaseRefused(reasonFrom(response.status, text))
  }

  try {
    return JSON.parse(text) as RecordedRelease
  } catch {
    throw new ReleaseRefused('That endpoint answered something that is not a release.')
  }
}

export function describeRelease(recorded: RecordedRelease): string[] {
  const lines = [
    recorded.created
      ? `recorded ${recorded.release.version}`
      : `${recorded.release.version} was already recorded, nothing changed`,
    `  id          ${recorded.release.id}`,
    `  environment ${recorded.release.environmentId}`,
    `  released at ${recorded.release.releasedAt}`,
  ]
  if (recorded.release.commit !== null) {
    lines.push(`  commit      ${recorded.release.commit}`)
  }
  if (recorded.release.sourcemapCount > 0) {
    lines.push(`  source maps ${recorded.release.sourcemapCount}`)
  }
  return lines
}
