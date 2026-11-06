import { generateKeyPairSync } from 'node:crypto'
import { signAccessToken, verifyAccessToken } from '@internal/auth'
import { afterEach, describe, expect, it, vi } from 'vitest'

function spki(): string {
  return generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString()
}

const CURRENT = generateKeyPairSync('ed25519')
const PREVIOUS = generateKeyPairSync('ed25519')

async function keysWith(environment: Record<string, string | undefined>) {
  vi.resetModules()
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) {
      vi.stubEnv(name, undefined)
    } else {
      vi.stubEnv(name, value)
    }
  }
  return import('../lib/keys.ts')
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('the keys a session is read with', () => {
  it('accepts a token from the previous key while a rotation is in flight', async () => {
    const { verifyingKeys } = await keysWith({
      AUTH_JWT_PUBLIC_KEY: CURRENT.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      AUTH_JWT_PREVIOUS_PUBLIC_KEY: PREVIOUS.publicKey
        .export({ type: 'spki', format: 'pem' })
        .toString(),
    })

    const keys = await verifyingKeys()
    expect(keys).toHaveLength(2)

    const { loadSigningKey } = await import('@internal/auth')
    for (const pair of [CURRENT, PREVIOUS]) {
      const signing = await loadSigningKey(
        pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      )
      const token = await signAccessToken(signing, { sub: 'usr_1', sid: 'sid_1' })

      expect(await verifyAccessToken(keys, token)).toEqual({ sub: 'usr_1', sid: 'sid_1' })
    }
  })

  it('holds only the current key when there is no rotation', async () => {
    const { verifyingKeys } = await keysWith({
      AUTH_JWT_PUBLIC_KEY: spki(),
      AUTH_JWT_PREVIOUS_PUBLIC_KEY: undefined,
    })

    expect(await verifyingKeys()).toHaveLength(1)
  })

  it('refuses to start reading sessions with no key at all', async () => {
    const { verifyingKeys } = await keysWith({ AUTH_JWT_PUBLIC_KEY: '' })

    expect(() => verifyingKeys()).toThrow(/AUTH_JWT_PUBLIC_KEY is not set/)
  })

  it('turns an escaped newline back into a newline, which is how a .env carries a PEM', async () => {
    const { verifyingKeys } = await keysWith({
      AUTH_JWT_PUBLIC_KEY: spki().replace(/\n/g, '\\n'),
      AUTH_JWT_PREVIOUS_PUBLIC_KEY: undefined,
    })

    expect(await verifyingKeys()).toHaveLength(1)
  })
})
