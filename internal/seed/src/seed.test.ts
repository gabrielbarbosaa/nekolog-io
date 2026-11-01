import { hashApiKey, parseApiKey } from '@internal/adapters'
import { describe, expect, it } from 'vitest'
import {
  HINT_CHARS,
  keyHint,
  parseSeedDocument,
  SEED_VERSION,
  SeedFormatError,
  serialiseSeedDocument,
  toDocument,
} from './document.ts'
import { encodeTime, MAX_ULID_TIME, RANDOM_CHARS, TIME_CHARS, ULID_CHARS, ulid } from './ids.ts'
import {
  assertEnvironmentNames,
  assertName,
  assertRetentionDays,
  buildSeed,
  DEFAULT_ENVIRONMENTS,
  DEFAULT_RETENTION_DAYS,
  MAX_NAME_CHARS,
  SCOPES_FOR,
  type Seed,
} from './model.ts'
import { environmentNamed, keyRecordsFor, keyStoreFromDocument } from './records.ts'

const NOON = Date.UTC(2026, 10, 1, 12, 0, 0)

function bytes(fill: number): (size: number) => Uint8Array {
  return (size) => new Uint8Array(size).fill(fill)
}

function seed(overrides: Partial<Parameters<typeof buildSeed>[0]> = {}): Promise<Seed> {
  return buildSeed({
    organization: 'ATF',
    project: 'checkout',
    now: () => NOON,
    ...overrides,
  })
}

describe('encodeTime', () => {
  it('always spends exactly the ten characters a ULID gives it', () => {
    expect(encodeTime(0)).toHaveLength(TIME_CHARS)
    expect(encodeTime(MAX_ULID_TIME)).toHaveLength(TIME_CHARS)
    expect(encodeTime(NOON)).toHaveLength(TIME_CHARS)
  })

  it('sorts by time as plain text', () => {
    const early = encodeTime(NOON)
    const late = encodeTime(NOON + 1)

    expect([late, early].sort()).toEqual([early, late])
  })

  it.each([-1, 1.5, Number.NaN, MAX_ULID_TIME + 1])('refuses the instant %s', (at) => {
    expect(() => encodeTime(at)).toThrow(/cannot carry/)
  })
})

describe('ulid', () => {
  it('is 26 characters of Crockford base32', () => {
    const value = ulid(NOON, bytes(0))

    expect(value).toHaveLength(ULID_CHARS)
    expect(value).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/)
  })

  it('never produces the letters Crockford leaves out', () => {
    const everyByte = ulid(NOON, (size) => Uint8Array.from({ length: size }, (_, i) => i * 8))

    expect(everyByte).not.toMatch(/[ILOU]/)
  })

  it('maps bytes onto the alphabet without bias, since 32 divides 256', () => {
    const counts = new Map<string, number>()
    for (let byte = 0; byte < 256; byte += 1) {
      const character = ulid(0, bytes(byte)).slice(TIME_CHARS, TIME_CHARS + 1)
      counts.set(character, (counts.get(character) ?? 0) + 1)
    }

    expect(counts.size).toBe(32)
    expect([...counts.values()].every((count) => count === 8)).toBe(true)
  })

  it('refuses to mint from the wrong amount of randomness', () => {
    expect(() => ulid(NOON, () => new Uint8Array(RANDOM_CHARS - 1))).toThrow(/random bytes/)
  })

  it('differs between calls', () => {
    expect(ulid(NOON)).not.toBe(ulid(NOON))
  })
})

describe('buildSeed', () => {
  it('gives the project the three environments the plan asks for', async () => {
    expect((await seed()).environments.map((entry) => entry.name)).toEqual([
      ...DEFAULT_ENVIRONMENTS,
    ])
  })

  it('mints a public and a secret key for each environment', async () => {
    for (const environment of (await seed()).environments) {
      expect(environment.keys.map((key) => key.kind)).toEqual(['public', 'secret'])
    }
  })

  it('mints keys the ingestion will actually parse', async () => {
    for (const environment of (await seed()).environments) {
      for (const key of environment.keys) {
        expect(parseApiKey(key.value)).toEqual({ kind: key.kind, value: key.value })
      }
    }
  })

  it('stores the hash of each key, and the hash really is of that key', async () => {
    const [environment] = (await seed()).environments
    const key = environment?.keys[0]

    expect(key && (await hashApiKey(key.value))).toBe(key?.hash)
  })

  it('never mints the same key twice', async () => {
    const values = (await seed()).environments.flatMap((e) => e.keys.map((key) => key.value))

    expect(new Set(values).size).toBe(values.length)
  })

  it('gives every id its own value', async () => {
    const built = await seed()
    const ids = [
      built.organization.id,
      built.project.id,
      ...built.environments.flatMap((e) => [e.id, ...e.keys.map((key) => key.id)]),
    ]

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('prefixes each id by what it names', async () => {
    const built = await seed()

    expect(built.organization.id.startsWith('org_')).toBe(true)
    expect(built.project.id.startsWith('prj_')).toBe(true)
    expect(built.environments[0]?.id.startsWith('env_')).toBe(true)
    expect(built.environments[0]?.keys[0]?.id.startsWith('key_')).toBe(true)
  })

  it('lets a public key write and a secret key also read', async () => {
    const [environment] = (await seed()).environments

    expect(environment?.keys[0]?.scopes).toEqual(SCOPES_FOR.public)
    expect(environment?.keys[1]?.scopes).toEqual(SCOPES_FOR.secret)
    expect(SCOPES_FOR.public).not.toContain('logs:read')
  })

  it('takes the environments it is given instead of the default three', async () => {
    const built = await seed({ environments: ['prod', 'qa'] })

    expect(built.environments.map((entry) => entry.name)).toEqual(['prod', 'qa'])
  })

  it('defaults the retention to what the hosted quota allows', async () => {
    expect((await seed()).environments[0]?.retentionDays).toBe(DEFAULT_RETENTION_DAYS)
  })

  it('leaves the origin list open unless it is told otherwise', async () => {
    expect((await seed()).environments[0]?.originAllowlist).toBeNull()
    expect(
      (await seed({ originAllowlist: ['https://a.test'] })).environments[0]?.originAllowlist,
    ).toEqual(['https://a.test'])
  })
})

describe('the names it refuses', () => {
  it.each(['', '   '])('refuses the empty name %p', (name) => {
    expect(() => assertName(name, 'project')).toThrow(/needs a name/)
  })

  it('refuses a name longer than the column will hold', () => {
    expect(() => assertName('x'.repeat(MAX_NAME_CHARS + 1), 'project')).toThrow(/at most/)
  })

  it('trims what it accepts', () => {
    expect(assertName('  checkout  ', 'project')).toBe('checkout')
  })

  it.each(['Production', 'pro duction', 'prod!', '1prod', '', 'a'.repeat(32)])(
    'refuses %p as an environment name',
    (name) => {
      expect(() => assertEnvironmentNames([name])).toThrow(/environment name/)
    },
  )

  it('refuses two environments with the same name', () => {
    expect(() => assertEnvironmentNames(['prod', 'prod'])).toThrow(/share a name/)
  })

  it('refuses a project with no environment at all', () => {
    expect(() => assertEnvironmentNames([])).toThrow(/at least one/)
  })

  it.each([0, -1, 1.5])('refuses the retention %s', (days) => {
    expect(() => assertRetentionDays(days)).toThrow(/whole number of days/)
  })
})

describe('keyHint', () => {
  it('shows the prefix and the last few characters, never the key', () => {
    expect(keyHint('nekolog_pk_abcdefghijklmnop')).toBe('nekolog_pk_…mnop')
  })

  it('gives away at most a handful of characters', () => {
    const hint = keyHint('nekolog_sk_abcdefghijklmnop')

    expect(hint.split('…')[1]).toHaveLength(HINT_CHARS)
  })
})

describe('the document it writes', () => {
  it('carries the hash of every key and the value of none', async () => {
    const document = toDocument(await seed())
    const raw = serialiseSeedDocument(document)

    expect(raw).not.toMatch(/nekolog_(pk|sk)_[A-Za-z0-9_-]{16,}/)
    for (const environment of document.environments) {
      for (const key of environment.keys) {
        expect(key.hash).toMatch(/^[0-9a-f]{64}$/)
      }
    }
  })

  it('reads back exactly what it wrote', async () => {
    const document = toDocument(await seed())

    expect(parseSeedDocument(serialiseSeedDocument(document))).toEqual(document)
  })

  it('refuses a document that smuggles a key in the clear', () => {
    expect(() =>
      parseSeedDocument(
        JSON.stringify({
          seedVersion: SEED_VERSION,
          createdAt: 0,
          organization: { id: 'org_1', name: 'o' },
          project: { id: 'prj_1', name: 'p' },
          environments: [
            {
              id: 'env_1',
              name: 'prod',
              retentionDays: 7,
              originAllowlist: null,
              keys: [
                {
                  id: 'key_1',
                  kind: 'secret',
                  hash: 'a',
                  hint: 'b',
                  scopes: ['logs:write'],
                  createdAt: 0,
                  value: 'nekolog_sk_leaked',
                },
              ],
            },
          ],
        }),
      ),
    ).toThrow(/never carry a key in the clear/)
  })

  it.each([
    ['not json', /not JSON/],
    ['[]', /has to be an object/],
    ['{"seedVersion":99}', /version 99/],
    [`{"seedVersion":${SEED_VERSION},"createdAt":0,"environments":[]}`, /at least one environment/],
  ])('refuses %p', (raw, message) => {
    expect(() => parseSeedDocument(raw)).toThrow(message)
    expect(() => parseSeedDocument(raw)).toThrow(SeedFormatError)
  })

  it('refuses a scope nobody defined', async () => {
    const document = toDocument(await seed()) as unknown as Record<string, never>
    const broken = JSON.parse(JSON.stringify(document))
    broken.environments[0].keys[0].scopes = ['logs:delete']

    expect(() => parseSeedDocument(JSON.stringify(broken))).toThrow(/is not a scope/)
  })
})

describe('the key records it hands the ingestion', () => {
  it('makes one record per key, keyed by the hash', async () => {
    const document = toDocument(await seed())
    const records = keyRecordsFor(document)

    expect(records).toHaveLength(6)
    expect(records.map((entry) => entry.keyHash)).toEqual(
      document.environments.flatMap((e) => e.keys.map((key) => key.hash)),
    )
  })

  it('points every record at its own environment and the one project', async () => {
    const document = toDocument(await seed())
    const records = keyRecordsFor(document)

    expect(new Set(records.map((entry) => entry.record.projectId)).size).toBe(1)
    expect(new Set(records.map((entry) => entry.record.environmentId)).size).toBe(3)
  })

  it('never seeds a key that is already blocked', async () => {
    const records = keyRecordsFor(toDocument(await seed()))

    expect(records.every((entry) => entry.record.blocked === false)).toBe(true)
  })

  it('carries the retention the environment was given', async () => {
    const records = keyRecordsFor(toDocument(await seed({ retentionDays: 3 })))

    expect(records.every((entry) => entry.record.retentionDays === 3)).toBe(true)
  })

  it('builds a store the ingestion can look a key up in', async () => {
    const built = await seed()
    const store = await keyStoreFromDocument(toDocument(built))
    const key = built.environments[0]?.keys[1]

    expect(await store.get(await hashApiKey(key?.value ?? ''))).toMatchObject({
      projectId: built.project.id,
      environmentId: built.environments[0]?.id,
      scopes: ['logs:write', 'logs:read'],
    })
  })

  it('does not know a key it never minted', async () => {
    const store = await keyStoreFromDocument(toDocument(await seed()))

    expect(await store.get(await hashApiKey('nekolog_sk_somethingelseentirely'))).toBeNull()
  })
})

describe('environmentNamed', () => {
  it('finds the environment by the name a person types', async () => {
    const document = toDocument(await seed())

    expect(environmentNamed(document, 'staging')).toBe(document.environments[1]?.id)
  })

  it('says which environments exist when the name is wrong', async () => {
    const document = toDocument(await seed())

    expect(() => environmentNamed(document, 'qa')).toThrow(/production, staging, development/)
  })
})
