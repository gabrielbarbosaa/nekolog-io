import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  ACCESS_TTL_SECONDS,
  JWT_ALGORITHM,
  JWT_AUDIENCE,
  JWT_ISSUER,
  kidOf,
  loadSigningKey,
  loadVerifyingKey,
  signAccessToken,
  verifyAccessToken,
} from './jwt.ts'

function pair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return {
    pkcs8: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    spki: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
}

const current = pair()
const older = pair()

describe('the key identifier', () => {
  it('comes from the key itself, so a rotation needs no extra configuration', async () => {
    const signing = await loadSigningKey(current.pkcs8)
    const verifying = await loadVerifyingKey(current.spki)

    expect(signing.kid).toBe(verifying.kid)
    expect(signing.kid).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('is different for a different key', async () => {
    expect((await loadSigningKey(current.pkcs8)).kid).not.toBe(
      (await loadSigningKey(older.pkcs8)).kid,
    )
  })

  it('travels in the token header, which is how the right key is found', async () => {
    const signing = await loadSigningKey(current.pkcs8)
    const token = await signAccessToken(signing, { sub: 'usr_1', sid: 'ses_1' })

    expect(kidOf(token)).toBe(signing.kid)
  })

  it('reads nothing out of a header that is not JSON', () => {
    expect(kidOf('not-a-token')).toBeUndefined()
    expect(kidOf('')).toBeUndefined()
  })
})

describe('an access token', () => {
  it('is signed with Ed25519 and carries only what the plan lists', async () => {
    const signing = await loadSigningKey(current.pkcs8)
    const token = await signAccessToken(signing, { sub: 'usr_1', sid: 'ses_1' })
    const [header, payload] = token.split('.') as [string, string]

    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
      alg: JWT_ALGORITHM,
      kid: signing.kid,
    })

    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString())
    expect(Object.keys(claims).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'sid', 'sub'])
    expect(claims.iss).toBe(JWT_ISSUER)
    expect(claims.aud).toBe(JWT_AUDIENCE)
    expect(claims.exp - claims.iat).toBe(ACCESS_TTL_SECONDS)
  })

  it('carries no role, because roles are read on the server', async () => {
    const signing = await loadSigningKey(current.pkcs8)
    const token = await signAccessToken(signing, { sub: 'usr_1', sid: 'ses_1' })
    const claims = JSON.parse(Buffer.from(token.split('.')[1] as string, 'base64url').toString())

    expect(claims.role).toBeUndefined()
    expect(claims.roles).toBeUndefined()
    expect(claims.org).toBeUndefined()
  })

  it('verifies against its own key and gives back the subject and session', async () => {
    const signing = await loadSigningKey(current.pkcs8)
    const verifying = await loadVerifyingKey(current.spki)
    const token = await signAccessToken(signing, { sub: 'usr_1', sid: 'ses_1' })

    expect(await verifyAccessToken([verifying], token)).toEqual({ sub: 'usr_1', sid: 'ses_1' })
  })
})

describe('what verification refuses', () => {
  it('a token signed by a key it does not hold', async () => {
    const stranger = await loadSigningKey(older.pkcs8)
    const token = await signAccessToken(stranger, { sub: 'usr_1', sid: 'ses_1' })

    expect(await verifyAccessToken([await loadVerifyingKey(current.spki)], token)).toBeUndefined()
  })

  it('a token whose signature was replaced, even with the right key id', async () => {
    const signing = await loadSigningKey(current.pkcs8)
    const token = await signAccessToken(signing, { sub: 'usr_1', sid: 'ses_1' })
    const [header, payload] = token.split('.')

    expect(
      await verifyAccessToken([await loadVerifyingKey(current.spki)], `${header}.${payload}.AAAA`),
    ).toBeUndefined()
  })

  it('an expired token', async () => {
    const signing = await loadSigningKey(current.pkcs8)
    const token = await signAccessToken(signing, { sub: 'usr_1', sid: 'ses_1' }, -1)

    expect(await verifyAccessToken([await loadVerifyingKey(current.spki)], token)).toBeUndefined()
  })

  it('a token with no algorithm, which is the classic forgery', async () => {
    const signing = await loadSigningKey(current.pkcs8)
    const header = Buffer.from(JSON.stringify({ alg: 'none', kid: signing.kid })).toString(
      'base64url',
    )
    const payload = Buffer.from(
      JSON.stringify({ sub: 'usr_1', sid: 'ses_1', iss: JWT_ISSUER, aud: JWT_AUDIENCE }),
    ).toString('base64url')

    expect(
      await verifyAccessToken([await loadVerifyingKey(current.spki)], `${header}.${payload}.`),
    ).toBeUndefined()
  })

  it('garbage, without throwing', async () => {
    const verifying = await loadVerifyingKey(current.spki)

    for (const token of ['', '.', 'a.b.c', 'null']) {
      expect(await verifyAccessToken([verifying], token), token).toBeUndefined()
    }
  })
})

describe('during a key rotation', () => {
  it('accepts tokens from both keys while both are configured', async () => {
    const [nowKey, thenKey] = [
      await loadSigningKey(current.pkcs8),
      await loadSigningKey(older.pkcs8),
    ]
    const keys = [await loadVerifyingKey(current.spki), await loadVerifyingKey(older.spki)]

    expect(
      await verifyAccessToken(keys, await signAccessToken(nowKey, { sub: 'a', sid: 'b' })),
    ).toEqual({ sub: 'a', sid: 'b' })
    expect(
      await verifyAccessToken(keys, await signAccessToken(thenKey, { sub: 'a', sid: 'b' })),
    ).toEqual({ sub: 'a', sid: 'b' })
  })

  it('stops accepting the old one as soon as it is dropped', async () => {
    const thenKey = await loadSigningKey(older.pkcs8)
    const token = await signAccessToken(thenKey, { sub: 'a', sid: 'b' })

    expect(await verifyAccessToken([await loadVerifyingKey(current.spki)], token)).toBeUndefined()
  })
})
