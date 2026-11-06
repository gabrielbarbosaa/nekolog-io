import { expect, test } from '@playwright/test'
import {
  anAccount,
  api,
  closeWorld,
  database,
  joinOrganization,
  openBrowser,
  signIn,
} from './support/world'

test.afterAll(async () => {
  await closeWorld()
})

type ApiKey = {
  id: string
  environmentId: string
  environment: string
  kind: string
  hint: string
  scopes: string[]
  lastUsedAt: string | null
  revokedAt: string | null
}

type Place = {
  page: Awaited<ReturnType<typeof openBrowser>>
  org: string
  project: string
  production: string
}

async function aPlace(context: Parameters<typeof openBrowser>[0]): Promise<Place> {
  const page = await openBrowser(context)
  const email = await anAccount(page)
  expect((await signIn(page, email)).status).toBe(200)

  const made = await api(page, '/api/orgs', { name: `Acme ${Date.now()}` })
  expect(made.status, JSON.stringify(made.body)).toBe(201)
  const org = String(made.body?.organization)

  const project = await api(page, `/api/orgs/${org}/projects`, { name: 'The Shop' })
  expect(project.status, JSON.stringify(project.body)).toBe(201)
  const environments = (project.body?.environments ?? []) as Array<{ id: string; name: string }>
  const production = environments.find((one) => one.name === 'production')
  expect(production).toBeDefined()

  return { page, org, project: String(project.body?.project), production: String(production?.id) }
}

async function keysOf(place: Place): Promise<ApiKey[]> {
  const listed = await api(place.page, `/api/orgs/${place.org}/projects/${place.project}/keys`)
  expect(listed.status, JSON.stringify(listed.body)).toBe(200)
  return (listed.body?.keys ?? []) as ApiKey[]
}

function mintAt(place: Place): string {
  return `/api/orgs/${place.org}/projects/${place.project}/environments/${place.production}/keys`
}

test('a key is shown once and never again', async ({ context }) => {
  const place = await aPlace(context)

  const minted = await api(place.page, mintAt(place), { kind: 'public' })
  expect(minted.status, JSON.stringify(minted.body)).toBe(201)

  const value = String(minted.body?.value)
  expect(value.startsWith('nekolog_pk_')).toBe(true)
  expect(String(minted.body?.hint)).toBe(`nekolog_pk_…${value.slice(-4)}`)

  const listed = await keysOf(place)
  expect(listed).toHaveLength(1)
  expect(listed[0]?.hint).toBe(minted.body?.hint)
  expect(
    JSON.stringify(listed),
    'the list must carry the hint and nothing that could be sent as a key',
  ).not.toContain(value)

  const rows = (await database().unsafe('select hash, hint from api_keys where id = $1', [
    String(minted.body?.key),
  ])) as unknown as Array<{ hash: string; hint: string }>
  const row = rows[0] as { hash: string; hint: string }
  expect(row.hash).toMatch(/^[0-9a-f]{64}$/)
  expect(row.hash).not.toContain(value.slice(11))
})

test('a public key may only write, and a secret key may be told to read', async ({ context }) => {
  const place = await aPlace(context)

  expect(
    (await api(place.page, mintAt(place), { kind: 'public', scopes: ['logs:read'] })).status,
  ).toBe(422)
  expect(
    (await api(place.page, mintAt(place), { kind: 'secret', scopes: ['logs:delete'] })).status,
  ).toBe(422)
  expect((await api(place.page, mintAt(place), { kind: 'master' })).status).toBe(422)

  const secret = await api(place.page, mintAt(place), {
    kind: 'secret',
    scopes: ['logs:read', 'logs:write'],
  })
  expect(secret.status, JSON.stringify(secret.body)).toBe(201)
  expect(String(secret.body?.value).startsWith('nekolog_sk_')).toBe(true)

  const listed = await keysOf(place)
  expect(listed.find((one) => one.id === secret.body?.key)?.scopes.sort()).toEqual([
    'logs:read',
    'logs:write',
  ])
})

test('rotating hands back a new key and retires the old one in the same breath', async ({
  context,
}) => {
  const place = await aPlace(context)
  const first = await api(place.page, mintAt(place), { kind: 'secret' })
  expect(first.status).toBe(201)

  const where = `/api/orgs/${place.org}/projects/${place.project}/keys/${first.body?.key}`
  const rotated = await api(place.page, `${where}/rotate`, {})
  expect(rotated.status, JSON.stringify(rotated.body)).toBe(200)
  expect(rotated.body?.value).not.toBe(first.body?.value)

  const listed = await keysOf(place)
  expect(listed.find((one) => one.id === first.body?.key)?.revokedAt).not.toBeNull()
  expect(listed.find((one) => one.id === rotated.body?.key)?.revokedAt).toBeNull()
  expect(
    listed.find((one) => one.id === rotated.body?.key)?.environmentId,
    'the replacement belongs to the same environment, or a key would change what it writes to',
  ).toBe(place.production)

  expect((await api(place.page, `${where}/rotate`, {})).status, 'and not twice').toBe(404)
})

test('revoking says so once and the key is gone from the live set', async ({ context }) => {
  const place = await aPlace(context)
  const minted = await api(place.page, mintAt(place), { kind: 'secret' })
  const where = `/api/orgs/${place.org}/projects/${place.project}/keys/${minted.body?.key}/revoke`

  expect((await api(place.page, where, {})).status).toBe(200)
  expect((await api(place.page, where, {})).status).toBe(404)

  expect((await keysOf(place)).find((one) => one.id === minted.body?.key)?.revokedAt).not.toBeNull()
})

test('a key of another organization cannot be seen, revoked or rotated', async ({
  context,
  browser,
}) => {
  const mine = await aPlace(context)
  const minted = await api(mine.page, mintAt(mine), { kind: 'secret' })
  const keyId = String(minted.body?.key)

  const other = await browser.newContext()
  const theirs = await aPlace(other)

  expect(
    (await api(theirs.page, `/api/orgs/${mine.org}/projects/${mine.project}/keys`)).status,
  ).toBe(404)

  const throughTheirOwn = await api(
    theirs.page,
    `/api/orgs/${theirs.org}/projects/${mine.project}/keys`,
  )
  expect(
    throughTheirOwn.status,
    'naming their own organization must not list the keys of my project',
  ).toBe(404)
  expect(JSON.stringify(throughTheirOwn.body)).not.toContain(keyId)

  expect(
    (
      await api(
        theirs.page,
        `/api/orgs/${theirs.org}/projects/${mine.project}/keys/${keyId}/revoke`,
        {},
      )
    ).status,
  ).toBe(404)
  expect(
    (
      await api(
        theirs.page,
        `/api/orgs/${theirs.org}/projects/${theirs.project}/keys/${keyId}/rotate`,
        {},
      ).then((answer) => answer)
    ).status,
    'naming their own project must not reach my key either',
  ).toBe(404)

  expect((await keysOf(mine)).find((one) => one.id === keyId)?.revokedAt).toBeNull()

  await other.close()
})

test('a member cannot see the keys at all, let alone mint one', async ({ context, browser }) => {
  const place = await aPlace(context)
  await api(place.page, mintAt(place), { kind: 'secret' })

  const other = await browser.newContext()
  const plain = await openBrowser(other)
  const theirEmail = await anAccount(plain)
  await joinOrganization(place.org, theirEmail, 'member')
  expect((await signIn(plain, theirEmail)).status).toBe(200)

  expect(
    (await api(plain, `/api/orgs/${place.org}/projects/${place.project}/keys`)).status,
    'a key hint names a credential; reading them is an administrator thing',
  ).toBe(403)
  expect((await api(plain, mintAt(place), { kind: 'secret' })).status).toBe(403)

  await other.close()
})

test('the audit log records the hint and never the key', async ({ context }) => {
  const place = await aPlace(context)
  const minted = await api(place.page, mintAt(place), { kind: 'secret' })
  await api(
    place.page,
    `/api/orgs/${place.org}/projects/${place.project}/keys/${minted.body?.key}/rotate`,
    {},
  )

  const audit = await api(place.page, `/api/orgs/${place.org}/audit`)
  const entries = (audit.body?.entries ?? []) as Array<{ action: string }>

  expect(entries.map((entry) => entry.action)).toContain('key.created')
  expect(entries.map((entry) => entry.action)).toContain('key.rotated')
  expect(JSON.stringify(audit.body)).not.toContain(String(minted.body?.value))
  expect(JSON.stringify(audit.body)).toContain(String(minted.body?.hint))
})
