import { expect, test } from '@playwright/test'
import { waitForMail } from './support/mail'
import {
  anAccount,
  api,
  closeWorld,
  database,
  openBrowser,
  PASSWORD,
  signIn,
} from './support/world'

test.afterAll(async () => {
  await closeWorld()
})

async function makeThemAnOperator(email: string): Promise<void> {
  await database().unsafe('update users set is_operator = true where email = $1', [email])
}

async function anOperator(context: Parameters<typeof openBrowser>[0]) {
  const page = await openBrowser(context)
  const email = await anAccount(page)
  await makeThemAnOperator(email)
  expect((await signIn(page, email)).status).toBe(200)

  return { page, email }
}

async function anEnvironmentOf(
  page: Parameters<typeof api>[0],
  org: string,
  project: string,
): Promise<string> {
  const read = await api(page, `/api/orgs/${org}/projects/${project}`)
  const environments = (read.body?.environments ?? []) as Array<{ id: string }>
  const first = environments[0]

  if (first === undefined) {
    throw new Error('the project was born with no environment')
  }
  return first.id
}

async function unlocked(context: Parameters<typeof openBrowser>[0]) {
  const made = await anOperator(context)
  expect((await api(made.page, '/api/operator/unlock', { password: PASSWORD })).status).toBe(200)
  return made
}

test.describe('the operator area', () => {
  test('is not there at all for an ordinary account', async ({ context }) => {
    const page = await openBrowser(context)
    const email = await anAccount(page)
    expect((await signIn(page, email)).status).toBe(200)

    await page.goto('/operator')
    await expect(page.getByText(/not found|404/i).first()).toBeVisible()

    const listed = await api(page, '/api/operator/organizations')
    expect(listed.status, 'a 403 would admit the area exists').toBe(404)
  })

  test('asks for the password before it shows anything', async ({ context }) => {
    const { page } = await anOperator(context)

    await page.goto('/operator')
    await expect(page.getByLabel('Your password')).toBeVisible()
    await expect(page.getByRole('heading', { name: /organizations/i })).toHaveCount(0)

    const listed = await api(page, '/api/operator/organizations')
    expect(listed.status).toBe(403)
    expect(listed.body?.error).toBe('locked')
  })

  test('refuses the wrong password and stays shut', async ({ context }) => {
    const { page } = await anOperator(context)

    const tried = await api(page, '/api/operator/unlock', { password: 'not the password' })
    expect(tried.status).toBe(401)

    expect((await api(page, '/api/operator/organizations')).status).toBe(403)
  })

  test('opens with the right password and lists the organizations', async ({ context }) => {
    const { page } = await unlocked(context)

    await page.goto('/operator')
    await expect(page.getByRole('heading', { name: /organizations/i })).toBeVisible()
  })

  test('starts an organization whose first person owns it', async ({ context }) => {
    const { page } = await unlocked(context)
    const founder = `founder-${Date.now()}@acme.test`

    const started = await api(page, '/api/operator/organizations', {
      name: 'A Brand New Tenant',
      email: founder,
    })
    expect(started.status, JSON.stringify(started.body)).toBe(201)

    const rows = await database().unsafe('select role from invites where organization_id = $1', [
      String(started.body?.organization),
    ])
    expect((rows[0] as { role?: string })?.role, 'the schema refuses an owner invite').toBe('admin')

    const message = await waitForMail(founder, 'A Brand New Tenant')
    expect(message.text, 'the invitation carries the link they sign up with').toContain('/signup?')
  })

  test('adjusts the quota, and the cap then binds an administrator', async ({ context }) => {
    const { page } = await unlocked(context)

    const org = String(
      (await api(page, '/api/orgs', { name: `Acme ${Date.now()}` })).body?.organization,
    )
    const project = String(
      (await api(page, `/api/orgs/${org}/projects`, { name: 'The Shop' })).body?.project,
    )
    const environment = await anEnvironmentOf(page, org, project)

    const settings = {
      retentionDays: 30,
      minLevel: 'trace',
      sampleRate: 1,
    }

    const over = await api(
      page,
      `/api/orgs/${org}/projects/${project}/environments/${environment}`,
      settings,
    )
    expect(over.status).toBe(422)
    expect(over.body?.error).toBe('over_the_retention_cap')
    expect(over.body?.cap).toBe(7)

    const raised = await api(page, `/api/operator/organizations/${org}`, {
      dailyEventQuota: 50_000,
      maxRetentionDays: 30,
    })
    expect(raised.status, JSON.stringify(raised.body)).toBe(200)

    const within = await api(
      page,
      `/api/orgs/${org}/projects/${project}/environments/${environment}`,
      settings,
    )
    expect(within.status).toBe(200)
  })

  test('pulls an environment back when the cap comes down under it', async ({ context }) => {
    const { page } = await unlocked(context)

    const org = String(
      (await api(page, '/api/orgs', { name: `Acme ${Date.now()}` })).body?.organization,
    )
    await api(page, `/api/operator/organizations/${org}`, {
      dailyEventQuota: 50_000,
      maxRetentionDays: 30,
    })
    const project = String(
      (await api(page, `/api/orgs/${org}/projects`, { name: 'The Shop' })).body?.project,
    )
    const environment = await anEnvironmentOf(page, org, project)

    await api(page, `/api/orgs/${org}/projects/${project}/environments/${environment}`, {
      retentionDays: 30,
      minLevel: 'trace',
      sampleRate: 1,
    })

    const lowered = await api(page, `/api/operator/organizations/${org}`, {
      dailyEventQuota: 1_000,
      maxRetentionDays: 3,
    })
    expect(lowered.body?.environmentsHeldBack).toBe(3)

    const after = await api(page, `/api/orgs/${org}/projects/${project}`)
    const environments = after.body?.environments as Array<{ retentionDays: number }>
    expect(environments.every((one) => one.retentionDays <= 3)).toBe(true)
  })

  test('suspends an account and ends the session it was holding', async ({ browser, context }) => {
    const { page } = await unlocked(context)

    const theirs = await browser.newContext()
    const victim = await openBrowser(theirs)
    const theirEmail = await anAccount(victim)
    expect((await signIn(victim, theirEmail)).status).toBe(200)

    const rows = await database().unsafe('select id from users where email = $1', [theirEmail])
    const userId = String((rows[0] as { id?: string })?.id)

    expect((await api(page, `/api/operator/accounts/${userId}`, { suspended: true })).status).toBe(
      200,
    )

    const back = await database().unsafe('select suspended_at from users where id = $1', [userId])
    expect((back[0] as { suspended_at?: unknown })?.suspended_at).not.toBeNull()

    expect(
      (await api(victim, '/api/orgs')).status,
      'the session they were already holding has to end with them',
    ).toBe(401)

    expect(
      (await signIn(victim, theirEmail)).status,
      'a suspended account cannot sign in again either',
    ).not.toBe(200)

    await theirs.close()
  })

  test('refuses to let an operator suspend themselves', async ({ context }) => {
    const { page, email } = await unlocked(context)
    const rows = await database().unsafe('select id from users where email = $1', [email])
    const userId = String((rows[0] as { id?: string })?.id)

    const tried = await api(page, `/api/operator/accounts/${userId}`, { suspended: true })

    expect(tried.status).toBe(409)
    expect(tried.body?.error).toBe('not_yourself')
  })

  test('suspends an organization, and its keys leave the list the ingestion reads', async ({
    context,
  }) => {
    const { page } = await unlocked(context)

    const org = String(
      (await api(page, '/api/orgs', { name: `Acme ${Date.now()}` })).body?.organization,
    )
    const project = String(
      (await api(page, `/api/orgs/${org}/projects`, { name: 'The Shop' })).body?.project,
    )
    const environment = await anEnvironmentOf(page, org, project)

    const minted = await api(
      page,
      `/api/orgs/${org}/projects/${project}/environments/${environment}/keys`,
      { kind: 'secret' },
    )
    expect(minted.status).toBe(201)
    const keyId = String(minted.body?.key)

    const live = async () =>
      (
        await database().unsafe(
          `select api_keys.id from api_keys
             join environments on environments.id = api_keys.environment_id
             join projects on projects.id = environments.project_id
             join organizations on organizations.id = projects.organization_id
            where api_keys.revoked_at is null and organizations.suspended_at is null`,
          [],
        )
      ).map((row) => String((row as { id?: string }).id))

    expect(await live()).toContain(keyId)

    expect(
      (await api(page, `/api/operator/organizations/${org}`, { suspended: true })).status,
    ).toBe(200)

    expect(await live(), 'key-sync publishes this list every minute').not.toContain(keyId)
  })

  test('counts usage without ever reading a log line', async ({ context }) => {
    const { page } = await unlocked(context)

    const counted = await api(page, '/api/operator/usage')

    expect(counted.status).toBe(200)
    expect(counted.body).toHaveProperty('usage')
    expect(JSON.stringify(counted.body), 'a message would be log content').not.toMatch(/message/i)
  })

  test('refuses a filter this build does not know', async ({ context }) => {
    const { page } = await unlocked(context)

    expect((await api(page, '/api/operator/usage?days=7')).status).toBe(400)
    expect((await api(page, '/api/operator/accounts?role=owner')).status).toBe(400)
  })
})
