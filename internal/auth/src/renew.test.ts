import { generateKeyPairSync } from 'node:crypto'
import type { RedisClient } from '@nekolog-io/adapters'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  loadSigningKey,
  loadVerifyingKeys,
  publicKeyBlocks,
  type SigningKey,
  signAccessToken,
  type VerifyingKey,
  verifyAccessToken,
} from './jwt.ts'
import { type RenewDeps, renewSession } from './renew.ts'
import { createSession, GRACE_MS, rotateRefresh } from './sessions.ts'
import { memoryRedis } from './testing/memory-redis.ts'

function pemPair(): { privateKey: string; publicKey: string } {
  const pair = generateKeyPairSync('ed25519')
  return {
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
}

const PAIR = pemPair()
const OTHER = pemPair()

let signing: SigningKey
let verifying: VerifyingKey[]

beforeAll(async () => {
  signing = await loadSigningKey(PAIR.privateKey)
  verifying = await loadVerifyingKeys(PAIR.publicKey)
})

function deps(redis: RedisClient): RenewDeps {
  return { redis, signing, verifying }
}

const SOMEWHERE = { device: 'Firefox on Linux x86_64', country: 'BR' }

describe('a request that already carries a valid access token', () => {
  it('carries on, and asks Redis nothing at all', async () => {
    const redis = memoryRedis()
    let asked = 0
    const counted: RedisClient = {
      ...redis,
      eval: async (script, keys, args) => {
        asked += 1
        return redis.eval(script, keys, args)
      },
    }

    const session = await createSession(
      { redis: counted },
      { userId: 'usr_owner', remember: true, ...SOMEWHERE },
    )
    const created = asked
    const accessToken = await signAccessToken(signing, { sub: 'usr_owner', sid: session.sid })

    const renewal = await renewSession(deps(counted), { accessToken })

    expect(renewal.outcome).toBe('carry-on')
    expect(asked, 'the proxy went to Redis for a token it could verify on its own').toBe(created)
  })
})

describe('a request whose access token has run out', () => {
  it('renews it from the refresh token, and hands back both', async () => {
    const redis = memoryRedis()
    const session = await createSession(
      { redis },
      { userId: 'usr_owner', remember: true, ...SOMEWHERE },
    )
    const stale = await signAccessToken(signing, { sub: 'usr_owner', sid: session.sid }, -10)

    const renewal = await renewSession(deps(redis), {
      accessToken: stale,
      refreshToken: session.refreshToken,
    })

    expect(renewal.outcome).toBe('renewed')
    if (renewal.outcome !== 'renewed') {
      return
    }
    expect(renewal.refreshToken).toBeDefined()
    expect(renewal.refreshToken).not.toBe(session.refreshToken)
    expect(renewal.remember).toBe(true)
    expect(await verifyAccessToken(verifying, renewal.accessToken)).toEqual({
      sub: 'usr_owner',
      sid: session.sid,
    })
  })

  it('takes the owner from the session, never from the token it just refused', async () => {
    const redis = memoryRedis()
    const session = await createSession(
      { redis },
      { userId: 'usr_owner', remember: true, ...SOMEWHERE },
    )
    const lie = await signAccessToken(signing, { sub: 'usr_somebody_else', sid: session.sid }, -10)

    const renewal = await renewSession(deps(redis), {
      accessToken: lie,
      refreshToken: session.refreshToken,
    })

    expect(renewal.outcome).toBe('renewed')
    if (renewal.outcome !== 'renewed') {
      return
    }
    expect(renewal.claims.sub).toBe('usr_owner')
  })

  it('renews for a session nobody asked to remember, and says so', async () => {
    const redis = memoryRedis()
    const session = await createSession(
      { redis },
      { userId: 'usr_owner', remember: false, ...SOMEWHERE },
    )

    const renewal = await renewSession(deps(redis), { refreshToken: session.refreshToken })

    expect(renewal.outcome).toBe('renewed')
    expect((renewal as { remember: boolean }).remember).toBe(false)
  })
})

describe('two tabs renewing at once', () => {
  it('gives the second one an access token and no second refresh token', async () => {
    const redis = memoryRedis()
    const session = await createSession(
      { redis },
      { userId: 'usr_owner', remember: true, ...SOMEWHERE },
    )
    const at = Date.now()
    await rotateRefresh({ redis }, session.refreshToken, { now: at })

    const renewal = await renewSession(
      deps(redis),
      { refreshToken: session.refreshToken },
      { now: at + 1000 },
    )

    expect(renewal.outcome).toBe('renewed')
    if (renewal.outcome !== 'renewed') {
      return
    }
    expect(
      renewal.refreshToken,
      'the other tab already holds the new refresh token',
    ).toBeUndefined()
    expect(await verifyAccessToken(verifying, renewal.accessToken)).toEqual({
      sub: 'usr_owner',
      sid: session.sid,
    })
  })
})

describe('what renews nobody', () => {
  it('reports a token used after the grace window as theft, with the owner', async () => {
    const redis = memoryRedis()
    const session = await createSession(
      { redis },
      { userId: 'usr_owner', remember: true, ...SOMEWHERE },
    )
    const at = Date.now()
    await rotateRefresh({ redis }, session.refreshToken, { now: at })

    const renewal = await renewSession(
      deps(redis),
      { refreshToken: session.refreshToken },
      { now: at + GRACE_MS + 1 },
    )

    expect(renewal).toEqual({ outcome: 'reused', userId: 'usr_owner' })
  })

  it('answers anonymous for no cookies, a token nobody issued, and a session that is gone', async () => {
    const redis = memoryRedis()
    const session = await createSession(
      { redis },
      { userId: 'usr_owner', remember: true, ...SOMEWHERE },
    )

    expect((await renewSession(deps(redis), {})).outcome).toBe('anonymous')
    expect((await renewSession(deps(redis), { accessToken: 'not-a-jwt' })).outcome).toBe(
      'anonymous',
    )
    expect(
      (await renewSession(deps(redis), { refreshToken: `${session.sid}.invented` })).outcome,
    ).toBe('anonymous')
    expect((await renewSession(deps(redis), { refreshToken: 'no-dot-here' })).outcome).toBe(
      'anonymous',
    )
  })

  it('refuses an access token signed by a key it does not hold', async () => {
    const stranger = await loadSigningKey(OTHER.privateKey)
    const token = await signAccessToken(stranger, { sub: 'usr_owner', sid: 'whatever' })

    expect((await renewSession(deps(memoryRedis()), { accessToken: token })).outcome).toBe(
      'anonymous',
    )
  })
})

describe('the public key may hold more than one key, so a rotation has an overlap', () => {
  it('reads every block out of one variable and accepts tokens from each', async () => {
    const bundle = `${PAIR.publicKey}\n${OTHER.publicKey}`
    const keys = await loadVerifyingKeys(bundle)
    const stranger = await loadSigningKey(OTHER.privateKey)

    expect(publicKeyBlocks(bundle)).toHaveLength(2)
    expect(keys[0]?.kid).not.toBe(keys[1]?.kid)
    expect(
      await verifyAccessToken(keys, await signAccessToken(signing, { sub: 'a', sid: 'b' })),
    ).toEqual({ sub: 'a', sid: 'b' })
    expect(
      await verifyAccessToken(keys, await signAccessToken(stranger, { sub: 'a', sid: 'b' })),
    ).toEqual({ sub: 'a', sid: 'b' })
  })

  it('refuses a variable with no key in it rather than trusting nothing silently', async () => {
    await expect(loadVerifyingKeys('   ')).rejects.toThrow(/no PEM public key/)
  })
})
