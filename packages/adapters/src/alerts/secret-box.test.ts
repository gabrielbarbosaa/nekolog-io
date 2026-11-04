import { describe, expect, it } from 'vitest'
import {
  fromHex,
  newChannelSecret,
  openSecret,
  SECRET_BOX_KEY_BYTES,
  SECRET_BOX_NONCE_BYTES,
  SECRET_BOX_VERSION,
  SIGNATURE_HEADER,
  sealSecret,
  secretKeyBytes,
  signPayload,
  toHex,
} from './secret-box.ts'

const KEY = 'a'.repeat(64)
const OTHER_KEY = 'b'.repeat(64)
const CHANNEL = 'ch_01JBQ8R4T7V2WXYZ0123456789'

describe('hex', () => {
  it('round-trips every byte', () => {
    const bytes = new Uint8Array([0, 1, 15, 16, 127, 128, 254, 255])

    expect(toHex(bytes)).toBe('00010f107f80feff')
    expect(fromHex(toHex(bytes))).toEqual(bytes)
  })

  it('refuses anything that is not lowercase hex of even length', () => {
    for (const bad of ['abc', 'AB', 'zz', 'ab cd']) {
      expect(() => fromHex(bad)).toThrow(/hexadecimal/)
    }
  })
})

describe('the key', () => {
  it('is thirty-two bytes written as sixty-four lowercase hex characters', () => {
    expect(SECRET_BOX_KEY_BYTES).toBe(32)
    expect(SECRET_BOX_NONCE_BYTES).toBe(12)
    expect(secretKeyBytes(KEY)).toHaveLength(32)
  })

  it('refuses a key of any other shape, rather than padding it', () => {
    for (const bad of ['a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), '', 'not-hex']) {
      expect(() => secretKeyBytes(bad)).toThrow(/64 lowercase hex/)
    }
  })

  it('mints a key of exactly that shape', () => {
    const minted = newChannelSecret()

    expect(minted).toMatch(/^[0-9a-f]{64}$/)
    expect(() => secretKeyBytes(minted)).not.toThrow()
    expect(newChannelSecret()).not.toBe(minted)
  })
})

describe('sealing a channel secret', () => {
  it('opens again with the same key and the same context', async () => {
    const sealed = await sealSecret('hunter2', KEY, CHANNEL)

    expect(await openSecret(sealed, KEY, CHANNEL)).toBe('hunter2')
  })

  it('never shows the plaintext in what it stores', async () => {
    const sealed = await sealSecret('hunter2', KEY, CHANNEL)

    expect(sealed).not.toContain('hunter2')
    expect(sealed.startsWith(`${SECRET_BOX_VERSION}.`)).toBe(true)
    expect(sealed).toMatch(/^v1\.[0-9a-f]{24}\.[0-9a-f]+$/)
  })

  it('writes a different box every time, so two equal secrets do not look equal', async () => {
    const first = await sealSecret('hunter2', KEY, CHANNEL)
    const second = await sealSecret('hunter2', KEY, CHANNEL)

    expect(first).not.toBe(second)
    expect(await openSecret(second, KEY, CHANNEL)).toBe('hunter2')
  })

  it('refuses to open with the wrong key', async () => {
    const sealed = await sealSecret('hunter2', KEY, CHANNEL)

    await expect(openSecret(sealed, OTHER_KEY, CHANNEL)).rejects.toThrow(/did not open/)
  })

  it('refuses to open under another channel, so a row cannot be moved', async () => {
    const sealed = await sealSecret('hunter2', KEY, CHANNEL)

    await expect(openSecret(sealed, KEY, 'ch_01JBQ8R4T7V2WXYZ012345678A')).rejects.toThrow(
      /did not open/,
    )
  })

  it('refuses a box whose bytes were touched', async () => {
    const sealed = await sealSecret('hunter2', KEY, CHANNEL)
    const parts = sealed.split('.')
    const flipped = `${parts[2]?.slice(0, -2)}${parts[2]?.endsWith('00') ? '11' : '00'}`

    await expect(openSecret(`${parts[0]}.${parts[1]}.${flipped}`, KEY, CHANNEL)).rejects.toThrow(
      /did not open/,
    )
  })

  it('refuses a version it does not know, instead of guessing the layout', async () => {
    const sealed = await sealSecret('hunter2', KEY, CHANNEL)
    const parts = sealed.split('.')

    await expect(openSecret(`v2.${parts[1]}.${parts[2]}`, KEY, CHANNEL)).rejects.toThrow(
      /not sealed by a version/,
    )
    await expect(openSecret('nonsense', KEY, CHANNEL)).rejects.toThrow(/not sealed by a version/)
  })

  it('refuses to seal nothing, or to seal without a context', async () => {
    await expect(sealSecret('', KEY, CHANNEL)).rejects.toThrow(/empty channel secret/)
    await expect(sealSecret('hunter2', KEY, '')).rejects.toThrow(/no context/)
  })

  it('carries a secret with any text in it, not only ascii', async () => {
    const secret = 'ação — 秘密 — 🔐'
    const sealed = await sealSecret(secret, KEY, CHANNEL)

    expect(await openSecret(sealed, KEY, CHANNEL)).toBe(secret)
  })
})

describe('signing a webhook body', () => {
  it('names the algorithm in the signature, as the specification says', async () => {
    const signature = await signPayload('{"a":1}', KEY)

    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/)
    expect(SIGNATURE_HEADER).toBe('X-NekoLog-Signature')
  })

  it('gives the same body the same signature, and a different body a different one', async () => {
    const first = await signPayload('{"a":1}', KEY)

    expect(await signPayload('{"a":1}', KEY)).toBe(first)
    expect(await signPayload('{"a":2}', KEY)).not.toBe(first)
  })

  it('gives the same body a different signature under another secret', async () => {
    expect(await signPayload('{"a":1}', KEY)).not.toBe(await signPayload('{"a":1}', OTHER_KEY))
  })

  it('matches a signature computed the same way by whoever receives it', async () => {
    const secret = newChannelSecret()
    const body = '{"state":"firing"}'

    const ours = await signPayload(body, secret)
    const theirs = await signPayload(body, secret)

    expect(ours).toBe(theirs)
  })
})
