import { expect, test } from '@playwright/test'
import { aMinuteOfLines, clickHouseAnswers, writeLines } from './support/lines'
import { api, closeWorld, database, newId, openBrowser, store } from './support/world'

test.afterAll(async () => {
  await closeWorld()
})

const DEMO_EMAIL = 'demo@nekolog.io'

async function aDemoWorld(): Promise<{
  organizationId: string
  projectId: string
  environmentId: string
}> {
  await database().unsafe(
    'delete from memberships where user_id in (select id from users where is_demo)',
    [],
  )
  await database().unsafe('delete from users where is_demo', [])
  await database().unsafe('delete from organizations where is_demo', [])

  const organizationId = newId('org_')
  const userId = newId('usr_')
  const projectId = newId('prj_')
  const environmentId = newId('env_')

  await database().unsafe('insert into organizations (id, name, is_demo) values ($1, $2, true)', [
    organizationId,
    'NekoLog Demo',
  ])
  await database().unsafe(
    `insert into users (id, name, email, password_hash, email_verified_at, is_demo)
     values ($1, 'Demo', $2, '$argon2id$v=19$m=19456,t=2,p=1$abc$def', now(), true)`,
    [userId, DEMO_EMAIL],
  )
  await database().unsafe(
    "insert into memberships (id, organization_id, user_id, role) values ($1, $2, $3, 'viewer')",
    [newId('mem_'), organizationId, userId],
  )
  await database().unsafe('insert into projects (id, organization_id, name) values ($1, $2, $3)', [
    projectId,
    organizationId,
    'storefront',
  ])
  await database().unsafe(
    "insert into environments (id, project_id, name, retention_days) values ($1, $2, 'production', 7)",
    [environmentId, projectId],
  )

  if (await clickHouseAnswers()) {
    await writeLines(
      projectId,
      environmentId,
      aMinuteOfLines(new Date(Date.now() - 30 * 60 * 1000), 40),
    )
  }

  return { organizationId, projectId, environmentId }
}

test.describe('the public demo', () => {
  test.beforeEach(async () => {
    const opened = await store().keys('demo:opened:*')
    if (opened.length > 0) {
      await store().del(...opened)
    }
  })
  test('opens without a password or an e-mail', async ({ context }) => {
    const world = await aDemoWorld()
    const page = await openBrowser(context)

    await page.goto('/demo')
    await page.getByRole('button', { name: /enter the demo/i }).click()

    await expect(page).toHaveURL(new RegExp(`/${world.organizationId}/projects`))
    await expect(page.getByText('storefront')).toBeVisible()
  })

  test('is offered on the sign-in screen', async ({ context }) => {
    await aDemoWorld()
    const page = await openBrowser(context)

    await page.goto('/login')
    await expect(page.getByRole('link', { name: /enter the demo/i })).toBeVisible()
  })

  test('reads the logs it was given', async ({ context }) => {
    test.skip(!(await clickHouseAnswers()), 'nothing is listening on ClickHouse')

    const world = await aDemoWorld()
    const page = await openBrowser(context)
    await api(page, '/api/demo', {})

    await page.goto(`/${world.organizationId}/${world.projectId}/logs?env=${world.environmentId}`)
    await expect(page.getByText('line number 39 <script>alert(1)</script>')).toBeVisible()
  })

  test('is refused everything that would change anything', async ({ context }) => {
    const world = await aDemoWorld()
    const page = await openBrowser(context)
    expect((await api(page, '/api/demo', {})).status).toBe(200)

    const where = `/api/orgs/${world.organizationId}`
    const refusals = [
      await api(page, `${where}/projects`, { name: 'Mine now' }),
      await api(page, `${where}/projects/${world.projectId}/environments/${world.environmentId}`, {
        retentionDays: 1,
        minLevel: 'trace',
        sampleRate: 1,
      }),
      await api(
        page,
        `${where}/projects/${world.projectId}/environments/${world.environmentId}/keys`,
        { kind: 'secret' },
      ),
      await api(page, `${where}/members/invite`, { email: 'x@acme.test', role: 'admin' }),
    ]

    for (const refused of refusals) {
      expect(refused.status, JSON.stringify(refused.body)).toBe(403)
    }
  })

  test('cannot make an organization of its own and own it', async ({ context }) => {
    await aDemoWorld()
    const page = await openBrowser(context)
    await api(page, '/api/demo', {})

    const tried = await api(page, '/api/orgs', { name: 'Escape Hatch' })

    expect(tried.status).toBe(403)
    expect(tried.body?.error).toBe('demo_is_read_only')

    const listed = await api(page, '/api/orgs')
    const organizations = (listed.body?.organizations ?? []) as unknown[]
    expect(organizations.length, 'it stays where it was put').toBe(1)
  })

  test('cannot touch the shared account it is signed in as', async ({ context }) => {
    await aDemoWorld()
    const page = await openBrowser(context)
    await api(page, '/api/demo', {})

    for (const [path, body] of [
      ['/api/auth/password/change', { current: 'x', password: 'a password of a legal length' }],
      ['/api/auth/email/change', { email: 'mine@acme.test' }],
      ['/api/auth/logout-all', {}],
    ] as const) {
      const tried = await api(page, path, body)
      expect(tried.status, path).toBe(403)
      expect(tried.body?.error).toBe('demo_is_read_only')
    }
  })

  test('cannot see who else is looking at the demo', async ({ context }) => {
    await aDemoWorld()
    const page = await openBrowser(context)
    await api(page, '/api/demo', {})

    const listed = await api(page, '/api/auth/sessions')

    expect(listed.status, 'the sessions of a shared account are other visitors').toBe(403)
    expect(listed.body?.error).toBe('demo_is_read_only')
  })

  test('is not offered the account screen, which refuses it anyway', async ({ context }) => {
    const world = await aDemoWorld()
    const page = await openBrowser(context)
    await api(page, '/api/demo', {})

    await page.goto(`/${world.organizationId}/projects`)
    await expect(page.getByRole('link', { name: /^account$/i })).toHaveCount(0)

    await page.goto('/account')
    await expect(page.getByText(/not found|404/i).first()).toBeVisible()
  })

  test('is not an operator, whatever anybody tries', async ({ context }) => {
    await aDemoWorld()
    const page = await openBrowser(context)
    await api(page, '/api/demo', {})

    expect((await api(page, '/api/operator/organizations')).status).toBe(404)

    await expect(
      database().unsafe('update users set is_operator = true where is_demo', []),
    ).rejects.toThrow(/users_a_demo_account_is_never_an_operator/)
  })

  test('holds the same visitor back once they have opened enough of them', async ({ context }) => {
    await aDemoWorld()
    const page = await openBrowser(context)

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await api(page, '/api/demo', {})).status, `attempt ${attempt}`).toBe(200)
    }

    const refused = await api(page, '/api/demo', {})

    expect(refused.status).toBe(429)
    expect(refused.body?.error).toBe('too_many_attempts')
    expect(refused.retryAfter, 'a 429 has to say when to come back').not.toBeNull()
  })

  test('says so rather than throwing when no demo is set up', async ({ context }) => {
    await database().unsafe(
      'delete from memberships where user_id in (select id from users where is_demo)',
      [],
    )
    await database().unsafe('delete from users where is_demo', [])
    await database().unsafe('delete from organizations where is_demo', [])

    const page = await openBrowser(context)
    const tried = await api(page, '/api/demo', {})

    expect(tried.status).toBe(503)
    expect(tried.body?.error).toBe('demo_unavailable')

    await page.goto('/login')
    await expect(page.getByRole('link', { name: /enter the demo/i })).toHaveCount(0)
  })
})
