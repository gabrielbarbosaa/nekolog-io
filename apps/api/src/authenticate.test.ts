import {
  generateApiKey,
  hashApiKey,
  type KeyRecord,
  memoryKeyStore,
  PUBLIC_KEY_PREFIX,
  SECRET_KEY_PREFIX,
} from '@nekolog-io/adapters'
import { beforeEach, describe, expect, it } from 'vitest'
import { createReadAuthenticator, READ_SCOPE } from './authenticate.ts'

const SECRET = `${SECRET_KEY_PREFIX}${'a'.repeat(32)}`
const PUBLIC = `${PUBLIC_KEY_PREFIX}${'b'.repeat(32)}`

const RECORD: KeyRecord = {
  projectId: 'prj_1',
  environmentId: 'env_1',
  scopes: ['logs:read'],
  originAllowlist: null,
  blocked: false,
}

let store: ReturnType<typeof memoryKeyStore>

beforeEach(async () => {
  store = memoryKeyStore()
  await store.set(await hashApiKey(SECRET), RECORD)
})

function asking(headers: Record<string, string>, url = 'https://api.nekolog.io/v1/logs'): Request {
  return new Request(url, { headers })
}

describe('the read authenticator, which is the only way into this API', () => {
  it('lets a secret key with logs:read through, and says which scope it is', async () => {
    const outcome = await createReadAuthenticator({ keyStore: store })(
      asking({ authorization: `Bearer ${SECRET}` }),
    )

    expect(outcome).toEqual({ ok: true, principal: { projectId: 'prj_1', environmentId: 'env_1' } })
    expect(READ_SCOPE).toBe('logs:read')
  })

  it('refuses a public key, because it is published to every browser', async () => {
    await store.set(await hashApiKey(PUBLIC), RECORD)

    const outcome = await createReadAuthenticator({ keyStore: store })(
      asking({ authorization: `Bearer ${PUBLIC}` }),
    )

    expect(outcome).toMatchObject({ ok: false, code: 'invalid_key' })
  })

  it('refuses a key in the URL even before it looks at the header', async () => {
    const outcome = await createReadAuthenticator({ keyStore: store })(
      asking({ authorization: `Bearer ${SECRET}` }, `https://api.nekolog.io/v1/logs?key=${SECRET}`),
    )

    expect(outcome).toMatchObject({ ok: false, code: 'secret_key_in_url' })
  })

  it('refuses an empty key parameter too, since a URL is written down everywhere', async () => {
    const outcome = await createReadAuthenticator({ keyStore: store })(
      asking({ authorization: `Bearer ${SECRET}` }, 'https://api.nekolog.io/v1/logs?key='),
    )

    expect(outcome).toMatchObject({ ok: false, code: 'secret_key_in_url' })
  })

  it('refuses a key that may write but not read', async () => {
    const writer = `${SECRET_KEY_PREFIX}${'c'.repeat(32)}`
    await store.set(await hashApiKey(writer), { ...RECORD, scopes: ['logs:write'] })

    const outcome = await createReadAuthenticator({ keyStore: store })(
      asking({ authorization: `Bearer ${writer}` }),
    )

    expect(outcome).toMatchObject({ ok: false, code: 'insufficient_scope' })
  })

  it('refuses a key nobody minted, and one that is not a key at all', async () => {
    const authenticate = createReadAuthenticator({ keyStore: store })

    for (const header of [
      `Bearer ${generateApiKey('secret')}`,
      'Bearer not-a-key',
      'Basic hunter2',
      `${SECRET}`,
    ]) {
      expect(await authenticate(asking({ authorization: header }))).toMatchObject({
        ok: false,
        code: 'invalid_key',
      })
    }

    expect(await authenticate(asking({}))).toMatchObject({ ok: false, code: 'invalid_key' })
  })

  it('carries the retention of the environment when the record has one', async () => {
    const kept = `${SECRET_KEY_PREFIX}${'d'.repeat(32)}`
    await store.set(await hashApiKey(kept), { ...RECORD, retentionDays: 30 })

    const outcome = await createReadAuthenticator({ keyStore: store })(
      asking({ authorization: `Bearer ${kept}` }),
    )

    expect(outcome).toMatchObject({ ok: true, principal: { retentionDays: 30 } })
  })
})
