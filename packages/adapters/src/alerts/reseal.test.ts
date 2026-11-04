import { describe, expect, it } from 'vitest'
import type { SqlRunner } from '../issues/sql-issue-store.ts'
import { RESEAL_BATCH, resealChannelSecrets } from './reseal.ts'
import {
  MAX_SIGNATURES,
  newChannelSecret,
  openSecret,
  sealSecret,
  signatureHeader,
  signPayload,
} from './secret-box.ts'

const OLD = 'a'.repeat(64)
const NEW = 'b'.repeat(64)
const CHANNEL = 'ch_01JBQ8R4T7V2WXYZ0123456789'
const OTHER = 'ch_01JBQ8R4T7V2WXYZ012345678A'

type Row = { id: string; sealed_secret: string | null; previous_sealed_secret: string | null }

function store(rows: Row[]): { run: SqlRunner; rows: Row[]; writes: number } {
  const state = { rows, writes: 0 }

  const run: SqlRunner = async (text, params) => {
    if (text.includes('select id, sealed_secret')) {
      const limit = Number(params[0])
      const offset = Number(params[1])
      return state.rows
        .filter((row) => row.sealed_secret !== null || row.previous_sealed_secret !== null)
        .slice(offset, offset + limit) as never
    }

    state.writes += 1
    const [id, sealed, previous] = params as [string, string | null, string | null]
    const found = state.rows.find((row) => row.id === id)
    if (found !== undefined) {
      found.sealed_secret = sealed
      found.previous_sealed_secret = previous
    }
    return []
  }

  return {
    run,
    rows: state.rows,
    get writes() {
      return state.writes
    },
  }
}

describe('resealing a channel secret onto a new key', () => {
  it('moves a secret from the old key to the new one, keeping what is inside', async () => {
    const secret = newChannelSecret()
    const rows: Row[] = [
      {
        id: CHANNEL,
        sealed_secret: await sealSecret(secret, OLD, CHANNEL),
        previous_sealed_secret: null,
      },
    ]
    const one = store(rows)

    const report = await resealChannelSecrets(one.run, OLD, NEW)

    expect(report).toMatchObject({ looked: 1, resealed: 1, alreadyNew: 0, failed: [] })
    expect(await openSecret(rows[0]?.sealed_secret ?? '', NEW, CHANNEL)).toBe(secret)
    await expect(openSecret(rows[0]?.sealed_secret ?? '', OLD, CHANNEL)).rejects.toThrow()
  })

  it('moves the previous secret too, so a rotation in flight is not broken', async () => {
    const current = newChannelSecret()
    const previous = newChannelSecret()
    const rows: Row[] = [
      {
        id: CHANNEL,
        sealed_secret: await sealSecret(current, OLD, CHANNEL),
        previous_sealed_secret: await sealSecret(previous, OLD, CHANNEL),
      },
    ]
    const one = store(rows)

    await resealChannelSecrets(one.run, OLD, NEW)

    expect(await openSecret(rows[0]?.sealed_secret ?? '', NEW, CHANNEL)).toBe(current)
    expect(await openSecret(rows[0]?.previous_sealed_secret ?? '', NEW, CHANNEL)).toBe(previous)
  })

  it('keeps each secret bound to its own channel', async () => {
    const first = newChannelSecret()
    const second = newChannelSecret()
    const rows: Row[] = [
      {
        id: CHANNEL,
        sealed_secret: await sealSecret(first, OLD, CHANNEL),
        previous_sealed_secret: null,
      },
      {
        id: OTHER,
        sealed_secret: await sealSecret(second, OLD, OTHER),
        previous_sealed_secret: null,
      },
    ]
    const one = store(rows)

    await resealChannelSecrets(one.run, OLD, NEW)

    expect(await openSecret(rows[1]?.sealed_secret ?? '', NEW, OTHER)).toBe(second)
    await expect(openSecret(rows[1]?.sealed_secret ?? '', NEW, CHANNEL)).rejects.toThrow()
  })

  it('can be run twice, because a secret already on the new key is left alone', async () => {
    const secret = newChannelSecret()
    const rows: Row[] = [
      {
        id: CHANNEL,
        sealed_secret: await sealSecret(secret, OLD, CHANNEL),
        previous_sealed_secret: null,
      },
    ]
    const one = store(rows)

    await resealChannelSecrets(one.run, OLD, NEW)
    const second = await resealChannelSecrets(one.run, OLD, NEW)

    expect(second).toMatchObject({ resealed: 0, alreadyNew: 1, failed: [] })
    expect(await openSecret(rows[0]?.sealed_secret ?? '', NEW, CHANNEL)).toBe(secret)
  })

  it('writes nothing in a dry run, but still proves the old key opens everything', async () => {
    const secret = newChannelSecret()
    const sealed = await sealSecret(secret, OLD, CHANNEL)
    const rows: Row[] = [{ id: CHANNEL, sealed_secret: sealed, previous_sealed_secret: null }]
    const one = store(rows)

    const report = await resealChannelSecrets(one.run, OLD, NEW, { dryRun: true })

    expect(report).toMatchObject({ resealed: 1, failed: [] })
    expect(rows[0]?.sealed_secret).toBe(sealed)
    expect(one.writes).toBe(0)
  })

  it('reports a secret it cannot open rather than destroying it', async () => {
    const rows: Row[] = [
      {
        id: CHANNEL,
        sealed_secret: 'v1.aabbccddeeff001122334455.00112233',
        previous_sealed_secret: null,
      },
    ]
    const one = store(rows)

    const report = await resealChannelSecrets(one.run, OLD, NEW)

    expect(report.resealed).toBe(0)
    expect(report.failed[0]?.id).toBe(CHANNEL)
    expect(rows[0]?.sealed_secret).toBe('v1.aabbccddeeff001122334455.00112233')
  })

  it('carries on with the next channel after one failed', async () => {
    const secret = newChannelSecret()
    const rows: Row[] = [
      { id: CHANNEL, sealed_secret: 'v1.aabb.ccdd', previous_sealed_secret: null },
      {
        id: OTHER,
        sealed_secret: await sealSecret(secret, OLD, OTHER),
        previous_sealed_secret: null,
      },
    ]
    const one = store(rows)

    const report = await resealChannelSecrets(one.run, OLD, NEW)

    expect(report).toMatchObject({ looked: 2, resealed: 1 })
    expect(report.failed).toHaveLength(1)
  })

  it('refuses to reseal onto the same key, which would change nothing', async () => {
    const one = store([])

    await expect(resealChannelSecrets(one.run, OLD, OLD)).rejects.toThrow(/same key/)
  })

  it('refuses a key that is not a key, before touching a single row', async () => {
    const one = store([])

    await expect(resealChannelSecrets(one.run, 'short', NEW)).rejects.toThrow(/64 lowercase hex/)
    await expect(resealChannelSecrets(one.run, OLD, 'short')).rejects.toThrow(/64 lowercase hex/)
  })

  it('works through the table in pages rather than loading all of it', async () => {
    const rows: Row[] = []
    for (let at = 0; at < 5; at += 1) {
      const id = `ch_01JBQ8R4T7V2WXYZ012345678${String.fromCharCode(65 + at)}`
      rows.push({
        id,
        sealed_secret: await sealSecret(newChannelSecret(), OLD, id),
        previous_sealed_secret: null,
      })
    }
    const one = store(rows)

    const report = await resealChannelSecrets(one.run, OLD, NEW, { batch: 2 })

    expect(report).toMatchObject({ looked: 5, resealed: 5 })
    expect(RESEAL_BATCH).toBe(100)
  })

  it('names what it did to each channel', async () => {
    const seen: Array<[string, string]> = []
    const rows: Row[] = [
      {
        id: CHANNEL,
        sealed_secret: await sealSecret(newChannelSecret(), OLD, CHANNEL),
        previous_sealed_secret: null,
      },
    ]
    const one = store(rows)

    await resealChannelSecrets(one.run, OLD, NEW, {
      onChannel: (id, outcome) => seen.push([id, outcome]),
    })

    expect(seen).toEqual([[CHANNEL, 'resealed']])
  })
})

describe('signing through a rotation', () => {
  it('sends one signature when there is one secret', async () => {
    const secret = newChannelSecret()

    expect(await signatureHeader('{}', [secret])).toBe(await signPayload('{}', secret))
  })

  it('sends both while a rotation overlaps, so a receiver on either keeps working', async () => {
    const current = newChannelSecret()
    const previous = newChannelSecret()

    const header = await signatureHeader('{}', [current, previous])

    expect(header.split(',')).toHaveLength(2)
    expect(header).toContain(await signPayload('{}', current))
    expect(header).toContain(await signPayload('{}', previous))
  })

  it('puts the current signature first, which is the one to prefer', async () => {
    const current = newChannelSecret()
    const previous = newChannelSecret()

    const header = await signatureHeader('{}', [current, previous])

    expect(header.startsWith(await signPayload('{}', current))).toBe(true)
  })

  it('never sends the same signature twice', async () => {
    const secret = newChannelSecret()

    expect((await signatureHeader('{}', [secret, secret])).split(',')).toHaveLength(1)
  })

  it('ignores an empty secret rather than signing with nothing', async () => {
    const secret = newChannelSecret()

    expect(await signatureHeader('{}', [secret, ''])).toBe(await signPayload('{}', secret))
  })

  it('refuses to sign with no secret at all', async () => {
    await expect(signatureHeader('{}', [])).rejects.toThrow(/no secret at all/)
    await expect(signatureHeader('{}', ['', ''])).rejects.toThrow(/no secret at all/)
  })

  it('refuses to send more signatures than a rotation ever needs', async () => {
    const three = [newChannelSecret(), newChannelSecret(), newChannelSecret()]

    await expect(signatureHeader('{}', three)).rejects.toThrow(/never more/)
    expect(MAX_SIGNATURES).toBe(2)
  })
})
