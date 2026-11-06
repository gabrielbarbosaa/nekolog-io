import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  FIRST_RUN_SETTINGS,
  GENERATED_SECRETS,
  renderFirstRunEnv,
  UnusableValue,
  VERSIONED_APPS,
  versionFrom,
  versionVariableFor,
} from './first-run.ts'
import { repositoryRoot, USAGE, up, versionsOf } from './up.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const HERE = join(ROOT, 'deploy', 'self-host')

const UP_SH = readFileSync(join(HERE, 'up.sh'), 'utf8')
const EXAMPLE = readFileSync(join(HERE, '.env.example'), 'utf8')
const UP_TS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'up.ts'), 'utf8')

function secretsOfUpSh(): { name: string; bytes: number }[] {
  return [...UP_SH.matchAll(/echo "([A-Z0-9_]+)=\$\(openssl rand -hex (\d+)\)"/g)].map((match) => ({
    name: match[1] as string,
    bytes: Number(match[2]),
  }))
}

function settingsOfUpSh(): { name: string; reads: string; fallback: string }[] {
  return [...UP_SH.matchAll(/echo "([A-Z0-9_]+)=\$\{([A-Z0-9_]+):-([^}]*)\}"/g)].map((match) => ({
    name: match[1] as string,
    reads: match[2] as string,
    fallback: match[3] as string,
  }))
}

const COUNTED = 'a nonsense value nobody could mistake for a secret'

function counting(): (bytes: number) => string {
  let call = 0
  return (bytes) => {
    call += 1
    return `${call}-${bytes}`
  }
}

describe('the first run', () => {
  it('writes the same variables whichever of the two scripts the operator ran', () => {
    expect(secretsOfUpSh()).toEqual(
      GENERATED_SECRETS.map((secret) => ({ name: secret.name, bytes: secret.bytes })),
    )
    expect(settingsOfUpSh().map(({ name, fallback }) => ({ name, fallback }))).toEqual(
      FIRST_RUN_SETTINGS.map((setting) => ({ name: setting.name, fallback: setting.fallback })),
    )
  })

  it('found both lists at all, so the comparison is not passing on nothing', () => {
    expect(secretsOfUpSh().length).toBeGreaterThanOrEqual(8)
    expect(settingsOfUpSh().length).toBeGreaterThanOrEqual(10)
  })

  it('lets each setting be overridden by the variable of its own name, never another', () => {
    for (const setting of settingsOfUpSh()) {
      expect(setting.reads, setting.name).toBe(setting.name)
    }
  })

  it('gives the secret box its thirty-two bytes and every password twenty-four', () => {
    const encryption = GENERATED_SECRETS.find((secret) => secret.name === 'ENCRYPTION_KEY')

    expect(encryption?.bytes).toBe(32)
    for (const secret of GENERATED_SECRETS) {
      if (secret.name !== 'ENCRYPTION_KEY') {
        expect(secret.bytes, secret.name).toBe(24)
      }
    }
  })

  it('names every variable it writes in .env.example, so nobody has to read a script', () => {
    for (const { name } of [...GENERATED_SECRETS, ...FIRST_RUN_SETTINGS]) {
      expect(EXAMPLE, `${name} is written but never mentioned in .env.example`).toContain(
        `${name}=`,
      )
    }
  })

  it('takes each setting from the environment and falls back when it is empty', () => {
    const written = renderFirstRunEnv(counting(), {
      NEKOLOG_DOMAIN: 'logs.example.com',
      ACME_EMAIL: '',
    })

    expect(written).toContain('NEKOLOG_DOMAIN=logs.example.com')
    expect(written).toContain('ACME_EMAIL=admin@localhost')
    expect(written).toContain('BACKUP_S3_ENDPOINT=\n')
    expect(written.endsWith('\n')).toBe(true)
  })

  it('asks for a fresh secret per variable, never one value used eight times', () => {
    const written = renderFirstRunEnv(counting(), {})
    const values = written
      .split('\n')
      .slice(0, GENERATED_SECRETS.length)
      .map((line) => line.split('=')[1])

    expect(new Set(values).size).toBe(GENERATED_SECRETS.length)
  })

  it('refuses a value carrying a line break instead of writing a variable nobody asked for', () => {
    expect(() =>
      renderFirstRunEnv(counting(), { NEKOLOG_DOMAIN: 'localhost\nENCRYPTION_KEY=0000' }),
    ).toThrow(UnusableValue)
    expect(() => renderFirstRunEnv(() => `${COUNTED}\nX=1`, {})).toThrow(UnusableValue)
  })

  it('reads each version from that app, never from one number kept by hand', () => {
    const versions = versionsOf(repositoryRoot())

    expect(Object.keys(versions)).toEqual(VERSIONED_APPS.map(versionVariableFor))
    for (const [name, value] of Object.entries(versions)) {
      expect(value, name).toMatch(/^\d+\.\d+\.\d+/)
    }
  })

  it('says so rather than guessing when a package.json declares no version', () => {
    expect(versionFrom('{"version": "1.2.3"}')).toBe('1.2.3')
    expect(() => versionFrom('{"name": "@apps/ingest"}')).toThrow(UnusableValue)
  })
})

describe('the first run on Windows', () => {
  it('needs neither openssl nor a shell, which is the whole reason it exists', () => {
    const started = [...UP_TS.matchAll(/spawner\('([a-z]+)'/g)].map((match) => match[1] as string)

    expect(started.length).toBeGreaterThan(0)
    expect([...new Set(started)]).toEqual(['docker'])
    expect(UP_TS).not.toContain('shell: true')
    expect(UP_TS).toContain("randomBytes(bytes).toString('hex')")
  })

  it('explains itself without starting anything', async () => {
    const lines: string[] = []
    const write = process.stdout.write
    process.stdout.write = ((chunk: string) => {
      lines.push(chunk)
      return true
    }) as typeof process.stdout.write

    let code: number
    try {
      code = await up(['--help'], {}, () => {
        throw new Error('--help started a container')
      })
    } finally {
      process.stdout.write = write
    }

    expect(code).toBe(0)
    expect(lines.join('')).toContain(USAGE)
  })
})
