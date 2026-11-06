import { expect, test } from '@playwright/test'
import {
  type Answer,
  anAccount,
  api,
  closeWorld,
  joinOrganization,
  openBrowser,
  PASSWORD,
  signIn,
} from './support/world'

test.afterAll(async () => {
  await closeWorld()
})

type Environment = {
  id: string
  name: string
  color: string | null
  retentionDays: number
  minLevel: string
  sampleRate: number
  dailyEventQuota: number | null
  originAllowlist: string[] | null
  liveKeys: number
}

const SOUND = {
  color: 'chart-2',
  retentionDays: 14,
  minLevel: 'info',
  sampleRate: 0.5,
  dailyEventQuota: 1000,
  originAllowlist: ['https://shop.test'],
  redactionRules: { patterns: ['email'] },
}

async function anOwner(context: Parameters<typeof openBrowser>[0]) {
  const page = await openBrowser(context)
  const email = await anAccount(page)
  expect((await signIn(page, email)).status).toBe(200)

  const made = await api(page, '/api/orgs', { name: `Acme ${Date.now()}` })
  expect(made.status, JSON.stringify(made.body)).toBe(201)

  return { page, email, org: String(made.body?.organization) }
}

async function aProject(
  page: Parameters<typeof api>[0],
  org: string,
  name = 'The Shop',
): Promise<string> {
  const made = await api(page, `/api/orgs/${org}/projects`, { name })
  expect(made.status, JSON.stringify(made.body)).toBe(201)
  return String(made.body?.project)
}

async function environmentsOf(
  page: Parameters<typeof api>[0],
  org: string,
  project: string,
): Promise<Environment[]> {
  const read = await api(page, `/api/orgs/${org}/projects/${project}`)
  expect(read.status, JSON.stringify(read.body)).toBe(200)
  return (read.body?.environments ?? []) as Environment[]
}

function named(all: Environment[], name: string): Environment {
  const found = all.find((one) => one.name === name)
  expect(found, `no environment called ${name}`).toBeDefined()
  return found as Environment
}

test('a new project arrives with production, staging and development', async ({ context }) => {
  const { page, org } = await anOwner(context)
  const project = await aProject(page, org)

  const environments = await environmentsOf(page, org, project)
  expect(environments.map((one) => one.name)).toEqual(['development', 'production', 'staging'])
  expect(environments.every((one) => one.color !== null)).toBe(true)
  expect(named(environments, 'production').liveKeys).toBe(0)

  const listed = await api(page, `/api/orgs/${org}/projects`)
  expect(listed.body?.projects as unknown[]).toContainEqual(
    expect.objectContaining({ id: project, name: 'The Shop', environments: 3 }),
  )
})

test('the settings of an environment survive the round trip', async ({ context }) => {
  const { page, org } = await anOwner(context)
  const project = await aProject(page, org)
  const production = named(await environmentsOf(page, org, project), 'production')

  const saved = await api(
    page,
    `/api/orgs/${org}/projects/${project}/environments/${production.id}`,
    SOUND,
  )
  expect(saved.status, JSON.stringify(saved.body)).toBe(200)

  const back = named(await environmentsOf(page, org, project), 'production')
  expect(back).toMatchObject({
    color: 'chart-2',
    retentionDays: 14,
    minLevel: 'info',
    sampleRate: 0.5,
    dailyEventQuota: 1000,
    originAllowlist: ['https://shop.test'],
  })
})

test('a setting that makes no sense is refused by name, and nothing moves', async ({ context }) => {
  const { page, org } = await anOwner(context)
  const project = await aProject(page, org)
  const staging = named(await environmentsOf(page, org, project), 'staging')
  const where = `/api/orgs/${org}/projects/${project}/environments/${staging.id}`

  const refusals: Array<[Record<string, unknown>, string, string]> = [
    [{ ...SOUND, sampleRate: 0 }, 'bad_sample_rate', 'sampleRate'],
    [{ ...SOUND, retentionDays: 0 }, 'bad_retention', 'retentionDays'],
    [{ ...SOUND, minLevel: 'verbose' }, 'unknown_level', 'minLevel'],
    [{ ...SOUND, originAllowlist: ['https://shop.test/orders'] }, 'bad_origins', 'originAllowlist'],
    [{ ...SOUND, redactionRules: { regex: '(a+)+$' } }, 'bad_redaction_rules', 'regex'],
  ]

  for (const [body, error, field] of refusals) {
    const answer: Answer = await api(page, where, body)
    expect(answer.status, JSON.stringify(answer.body)).toBe(422)
    expect(answer.body).toEqual({ error, field })
  }

  const back = named(await environmentsOf(page, org, project), 'staging')
  expect(back.retentionDays, 'a refused save must not have written half of itself').toBe(7)
  expect(back.sampleRate).toBe(1)
})

test('a project of another organization is invisible from this one', async ({
  context,
  browser,
}) => {
  const { page, org } = await anOwner(context)
  const project = await aProject(page, org)
  const production = named(await environmentsOf(page, org, project), 'production')

  const other = await browser.newContext()
  const theirs = await anOwner(other)

  expect((await api(theirs.page, `/api/orgs/${org}/projects`)).status).toBe(404)
  expect((await api(theirs.page, `/api/orgs/${org}/projects/${project}`)).status).toBe(404)

  const throughTheirOwn = await api(
    theirs.page,
    `/api/orgs/${theirs.org}/projects/${project}/environments/${production.id}`,
    SOUND,
  )
  expect(
    throughTheirOwn.status,
    'naming their own organization must not reach my project either',
  ).toBe(404)

  const mine = named(await environmentsOf(page, org, project), 'production')
  expect(mine.retentionDays, 'nothing of mine may have moved').toBe(7)

  await other.close()
})

test('a member may read a project and may not change one', async ({ context, browser }) => {
  const { page, org } = await anOwner(context)
  const project = await aProject(page, org)
  const production = named(await environmentsOf(page, org, project), 'production')

  const other = await browser.newContext()
  const plain = await openBrowser(other)
  const theirEmail = await anAccount(plain)
  await joinOrganization(org, theirEmail, 'member')
  expect((await signIn(plain, theirEmail)).status).toBe(200)

  expect((await api(plain, `/api/orgs/${org}/projects`)).status, 'a member may read').toBe(200)
  expect((await api(plain, `/api/orgs/${org}/projects/${project}`)).status).toBe(200)

  expect((await api(plain, `/api/orgs/${org}/projects`, { name: 'Theirs' })).status).toBe(403)
  expect(
    (await api(plain, `/api/orgs/${org}/projects/${project}`, { name: 'Renamed' })).status,
  ).toBe(403)
  expect(
    (await api(plain, `/api/orgs/${org}/projects/${project}/environments/${production.id}`, SOUND))
      .status,
  ).toBe(403)
  expect(
    (await api(plain, `/api/orgs/${org}/projects/${project}/delete`, { password: PASSWORD }))
      .status,
    'knowing a password is no use without the permission',
  ).toBe(403)

  expect(named(await environmentsOf(page, org, project), 'production').retentionDays).toBe(7)

  await other.close()
})

test('an environment can be added and the last one cannot be taken away', async ({ context }) => {
  const { page, org } = await anOwner(context)
  const project = await aProject(page, org)
  const where = `/api/orgs/${org}/projects/${project}/environments`

  const added = await api(page, where, { name: 'qa', color: 'chart-5' })
  expect(added.status, JSON.stringify(added.body)).toBe(201)
  expect((await api(page, where, { name: 'qa' })).status).toBe(409)
  expect((await api(page, where, { name: 'QA 1' })).status).toBe(422)

  for (const one of await environmentsOf(page, org, project)) {
    const gone = await api(page, `${where}/${one.id}/delete`, {})
    expect([200, 409]).toContain(gone.status)
  }

  const left = await environmentsOf(page, org, project)
  expect(left, 'a project with no environment can hold no key at all').toHaveLength(1)
  expect((await api(page, `${where}/${left[0]?.id}/delete`, {})).body).toEqual({
    error: 'the_last_environment',
  })
})

test('deleting a project asks for the password, and takes its environments with it', async ({
  context,
}) => {
  const { page, org } = await anOwner(context)
  const project = await aProject(page, org)
  const where = `/api/orgs/${org}/projects/${project}/delete`

  expect((await api(page, where, { password: 'not it' })).status).toBe(401)
  expect((await api(page, `/api/orgs/${org}/projects/${project}`)).status).toBe(200)

  expect((await api(page, where, { password: PASSWORD })).status).toBe(200)
  expect((await api(page, `/api/orgs/${org}/projects/${project}`)).status).toBe(404)
  expect((await api(page, `/api/orgs/${org}/projects`)).body?.projects).toEqual([])

  const audit = await api(page, `/api/orgs/${org}/audit`)
  const actions = ((audit.body?.entries ?? []) as Array<{ action: string }>).map(
    (entry) => entry.action,
  )
  expect(actions).toContain('project.deleted')
  expect(actions).toContain('project.created')
})
