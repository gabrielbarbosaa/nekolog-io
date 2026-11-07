import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseEnv, valuesOf } from './env.ts'

function fromRoot(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), 'utf8')
}

const EXAMPLE = valuesOf(parseEnv(fromRoot('.env.example')))
const ROOT_MANIFEST = JSON.parse(fromRoot('package.json')) as {
  scripts: Record<string, string>
}

function manifest(path: string): { scripts?: Record<string, string> } {
  return JSON.parse(fromRoot(`${path}/package.json`)) as { scripts?: Record<string, string> }
}

describe('the two directories the ingestion and the jobs share', () => {
  it('are the same path in .env.example, or one writes where the other does not read', () => {
    expect(EXAMPLE.KV_DIR).toBeDefined()
    expect(EXAMPLE.SPOOL_DIR).toBeDefined()
    expect(EXAMPLE.KV_DIR).not.toBe(EXAMPLE.SPOOL_DIR)
  })

  it('are relative, which is only safe because the entries resolve them', () => {
    expect(EXAMPLE.KV_DIR?.startsWith('/')).toBe(false)
    expect(EXAMPLE.KV_DIR).toMatch(/^\.nekolog-dev\//)
  })

  it.each([
    ['apps/ingest/src/serve.ts', 'kvDir'],
    ['apps/jobs/src/serve.ts', 'kvDir'],
    ['apps/jobs/src/serve.ts', 'spoolDir'],
  ])('%s resolves %s against the repository root, not against its own cwd', (file, field) => {
    const source = fromRoot(file)

    expect(source).toContain(
      "const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')",
    )
    expect(
      source,
      `a relative ${field} would land under ${file.split('/').slice(0, 2).join('/')}`,
    ).toMatch(new RegExp(`${field}: resolve\\(ROOT, `))
  })
})

describe('Turnstile in the example environment', () => {
  it('is off, because nothing in dev renders the widget', () => {
    expect(
      EXAMPLE.TURNSTILE_SECRET_KEY,
      'a secret here turns the check on and every sign-up answers challenge_failed',
    ).toBe('')
  })

  it('still records the always-pass pair, for when somebody wants to exercise it', () => {
    expect(fromRoot('.env.example')).toContain('1x0000000000000000000000000000000AA')
  })
})

describe('the e-mail allowlist in the example environment', () => {
  it('is not empty, because an empty list allows nobody', () => {
    expect(EXAMPLE.APP_ENV).not.toBe('prod')
    expect(
      EXAMPLE.EMAIL_ALLOWLIST,
      'with no allowlist no confirmation code is ever sent, so nobody can finish signing up',
    ).not.toBe('')
  })

  it('covers the domain the examples and the tests use', () => {
    expect(EXAMPLE.EMAIL_ALLOWLIST?.split(',')).toContain('@acme.test')
  })
})

describe('what `turbo run dev` starts', () => {
  it.each(['apps/ingest', 'apps/jobs', 'apps/api', 'apps/dashboard', 'apps/web', 'apps/docs'])(
    '%s has a dev script',
    (app) => {
      expect(manifest(app).scripts?.dev).toBeDefined()
    },
  )

  it.each(['apps/ingest', 'apps/jobs', 'apps/api'])(
    '%s loads the root .env, which is the only place those values live',
    (app) => {
      expect(manifest(app).scripts?.dev).toContain('--env-file-if-exists=../../.env')
    },
  )

  it('starts the dashboard through node so it sees the root .env too', () => {
    const scripts = manifest('apps/dashboard').scripts ?? {}

    expect(scripts.dev).toContain('--env-file-if-exists=../../.env')
    expect(scripts.start).toContain('--env-file-if-exists=../../.env')
    expect(scripts.dev, 'next reads .env from its own directory, not from the root').toContain(
      'node',
    )
  })
})

describe('the one command that is supposed to bring it all up', () => {
  it('writes the environment, starts the containers, waits, migrates, then runs', () => {
    const dev = ROOT_MANIFEST.scripts.dev ?? ''

    expect(dev.indexOf('dev:env')).toBeGreaterThanOrEqual(0)
    expect(dev.indexOf('dev:infra')).toBeGreaterThan(dev.indexOf('dev:env'))
    expect(dev.indexOf('dev:wait')).toBeGreaterThan(dev.indexOf('dev:infra'))
    expect(dev.indexOf('dev:migrate')).toBeGreaterThan(dev.indexOf('dev:wait'))
    expect(dev.indexOf('turbo run dev')).toBeGreaterThan(dev.indexOf('dev:migrate'))
  })

  it('migrates both databases, because a missing column refuses every insert', () => {
    const migrate = ROOT_MANIFEST.scripts['dev:migrate'] ?? ''

    expect(migrate).toContain('db:migrate')
    expect(migrate).toContain('ch:migrate')
  })

  it('offers a doctor that reads the environment it is diagnosing', () => {
    expect(ROOT_MANIFEST.scripts['dev:doctor']).toContain('--env-file-if-exists=.env')
  })
})
