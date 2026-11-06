import { expect, test } from '@playwright/test'
import { aMinuteOfLines, clickHouseAnswers, writeLines } from './support/lines'
import { anAccount, api, closeWorld, openBrowser, signIn } from './support/world'

test.afterAll(async () => {
  await closeWorld()
})

function aLine(at: number): string {
  return `line number ${at} <script>alert(1)</script>`
}

const WIDE = {
  from: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  to: new Date(Date.now() + 60 * 1000).toISOString(),
}

async function aProjectWithLines(context: Parameters<typeof openBrowser>[0], howMany = 120) {
  const page = await openBrowser(context)
  const email = await anAccount(page)
  expect((await signIn(page, email)).status).toBe(200)

  const org = String(
    (await api(page, '/api/orgs', { name: `Acme ${Date.now()}` })).body?.organization,
  )
  const project = String(
    (await api(page, `/api/orgs/${org}/projects`, { name: 'The Shop' })).body?.project,
  )
  const read = await api(page, `/api/orgs/${org}/projects/${project}`)
  const environments = (read.body?.environments ?? []) as Array<{ id: string; name: string }>

  const production = environments.find((one) => one.name === 'production') ?? environments[0]
  if (production === undefined) {
    throw new Error('the project was born with no environment')
  }

  await writeLines(
    project,
    production.id,
    aMinuteOfLines(new Date(Date.now() - 30 * 60 * 1000), howMany),
  )

  return { page, org, project, environment: production.id, environments }
}

test.describe('the explorer', () => {
  test.beforeEach(async () => {
    if (await clickHouseAnswers()) {
      return
    }
    if (process.env.CLICKHOUSE_TEST_REQUIRED === '1') {
      throw new Error(
        'CLICKHOUSE_TEST_REQUIRED is set and nothing answers on ClickHouse. These tests must ' +
          'not be skipped here: start the dev stack with `pnpm dev:infra` first.',
      )
    }
    test.skip(true, 'nothing is listening on ClickHouse')
  })

  test('draws the lines a project actually has', async ({ context }) => {
    const { page, org, project, environment } = await aProjectWithLines(context)

    await page.goto(`/${org}/${project}/logs?env=${environment}&period=1h`)

    const rows = page.getByRole('listitem').filter({ has: page.getByRole('button') })
    await expect(rows.first()).toBeVisible()
    await expect(page.getByText(aLine(119), { exact: true })).toBeVisible()

    const drawn = await rows.count()
    expect(drawn, 'the table draws a window, not all 120 lines').toBeLessThan(120)
  })

  test('never runs a log line as markup', async ({ context }) => {
    const { page, org, project, environment } = await aProjectWithLines(context, 5)

    let alerted = false
    page.on('dialog', async (dialog) => {
      alerted = true
      await dialog.dismiss()
    })

    await page.goto(`/${org}/${project}/logs?env=${environment}&period=1h`)
    await expect(page.getByText(aLine(0), { exact: true })).toBeVisible()
    await expect(page.locator('script:has-text("alert(1)")')).toHaveCount(0)

    expect(alerted, 'a log line is untrusted input and ran as script').toBe(false)
  })

  test('is served with no style attribute, which the policy would block', async ({ context }) => {
    const { page, org, project, environment } = await aProjectWithLines(context, 5)
    const where = `/${org}/${project}/logs?env=${environment}&period=1h`

    await page.goto(where)
    await expect(page.getByText(aLine(4), { exact: true })).toBeVisible()

    const html = await (await page.request.get(where)).text()
    const attributes = [...html.matchAll(/style="[^"]{0,60}/g)].map((match) => match[0])

    expect(
      attributes,
      'style-src carries a nonce, and a nonce never reaches a style attribute',
    ).toEqual([])
  })

  test('opens one line and shows what it carries', async ({ context }) => {
    const { page, org, project, environment } = await aProjectWithLines(context, 20)

    await page.goto(`/${org}/${project}/logs?env=${environment}&period=1h`)
    await page.getByRole('button', { name: /line number 19/ }).click()

    const panel = page.getByRole('complementary')
    await expect(panel).toBeVisible()
    await expect(panel.getByText('ord_19', { exact: true })).toBeVisible()
    await expect(panel.locator('pre').last(), 'the whole record, as text').toContainText(
      '"orderId": "ord_19"',
    )
    await expect(page).toHaveURL(/[?&]at=/)
  })

  test('keeps the filters in the address, so the view can be shared', async ({ context }) => {
    const { page, org, project, environment } = await aProjectWithLines(context, 40)

    await page.goto(`/${org}/${project}/logs?env=${environment}`)
    await page.getByLabel('Search').fill('level:error')
    await page.getByLabel('Search').press('Enter')

    await expect(page).toHaveURL(/q=level%3Aerror/)
    await expect(page.getByText(aLine(2), { exact: true })).toBeVisible()
    await expect(page.getByText(aLine(1), { exact: true }), 'line 1 is a warn').toHaveCount(0)
  })

  test('refuses an environment that belongs to another project', async ({ context }) => {
    const { page, org, environment } = await aProjectWithLines(context, 3)
    const other = String(
      (await api(page, `/api/orgs/${org}/projects`, { name: 'Somewhere else' })).body?.project,
    )

    const answer = await api(
      page,
      `/api/orgs/${org}/projects/${other}/logs?env=${environment}&from=${WIDE.from}&to=${WIDE.to}`,
    )

    expect(answer.status).toBe(404)
    expect(answer.body?.error).toBe('no_such_environment')
  })

  test('refuses a filter this build does not know', async ({ context }) => {
    const { page, org, project, environment } = await aProjectWithLines(context, 3)

    const answer = await api(
      page,
      `/api/orgs/${org}/projects/${project}/logs?env=${environment}&from=${WIDE.from}&to=${WIDE.to}&tenant=someone`,
    )

    expect(answer.status).toBe(400)
    expect(answer.body?.error).toBe('unknown_parameter')
  })

  test('says what it could not read in a search, and keeps the rest working', async ({
    context,
  }) => {
    const { page, org, project, environment } = await aProjectWithLines(context, 3)
    const where = `/api/orgs/${org}/projects/${project}/logs?env=${environment}&from=${WIDE.from}&to=${WIDE.to}`

    const refused = await api(page, `${where}&q=${encodeURIComponent('level:')}`)
    expect(refused.status).toBe(422)
    expect(refused.body?.error).toBe('bad_search')
    expect(String(refused.body?.detail).length).toBeGreaterThan(5)

    const fine = await api(page, `${where}&q=level%3Aerror`)
    expect(fine.status).toBe(200)
  })

  test('answers the lines around one line', async ({ context }) => {
    const { page, org, project, environment } = await aProjectWithLines(context, 60)
    const start = new Date(Date.now() - 30 * 60 * 1000)
    const at = new Date(start.getTime() + 30 * 1000).toISOString()

    const answer = await api(
      page,
      `/api/orgs/${org}/projects/${project}/logs/context?env=${environment}&at=${at}`,
    )

    expect(answer.status).toBe(200)
    const rows = (answer.body?.rows ?? []) as Array<{ context_side: number }>
    expect(rows.length).toBeGreaterThan(1)
    expect(new Set(rows.map((row) => row.context_side))).toContain(1)
  })
})
