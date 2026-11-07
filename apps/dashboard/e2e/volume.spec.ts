import { expect, test } from '@playwright/test'
import { aProjectWithLines, clickHouseAnswers } from './support/lines'
import { api, closeWorld } from './support/world'

test.afterAll(async () => {
  await closeWorld()
})

const WIDE = {
  from: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  to: new Date(Date.now() + 60 * 1000).toISOString(),
}

async function canvasOf(page: Parameters<typeof api>[0]): Promise<string> {
  return page
    .locator('canvas')
    .first()
    .evaluate((node) => (node as HTMLCanvasElement).toDataURL())
}

test.describe('the volume chart', () => {
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

  test('counts the same lines the table lists', async ({ context }) => {
    const { page, org, project, environment } = await aProjectWithLines(context, 40)

    await page.goto(`/${org}/${project}/logs?env=${environment}&period=1h`)

    const chart = page.getByRole('region', { name: /volume/i })
    await expect(chart.getByText('40 lines in this period')).toBeVisible()
    await expect(chart.locator('canvas')).toBeVisible()
  })

  test('narrows with the search, so the bars answer the same question', async ({ context }) => {
    const { page, org, project, environment } = await aProjectWithLines(context, 40)

    await page.goto(`/${org}/${project}/logs?env=${environment}&period=1h`)
    const chart = page.getByRole('region', { name: /volume/i })
    await expect(chart.getByText('40 lines in this period')).toBeVisible()

    await page.getByLabel('Search').fill('level:error')
    await page.getByLabel('Search').press('Enter')

    await expect(chart.getByText('10 lines in this period')).toBeVisible()
  })

  test('offers the same numbers as a table anyone can read', async ({ context }) => {
    const { page, org, project, environment } = await aProjectWithLines(context, 40)

    await page.goto(`/${org}/${project}/logs?env=${environment}&period=1h`)
    const chart = page.getByRole('region', { name: /volume/i })
    await expect(chart.locator('canvas')).toBeVisible()

    await chart.getByRole('button', { name: /table/i }).click()

    const table = chart.locator('table')
    await expect(table).toBeVisible()
    await expect(chart.locator('canvas')).toHaveCount(0)

    const headers = await table.locator('thead th').allInnerTexts()
    expect(headers.slice(1).sort()).toEqual(['debug', 'error', 'info', 'warn'])

    const counted = await table.locator('tbody td').allInnerTexts()
    const total = counted.reduce((sum, one) => sum + Number(one), 0)
    expect(total, 'the table has to add up to what the chart claims').toBe(40)
  })

  test('repaints when the theme changes, instead of keeping the light palette', async ({
    context,
  }) => {
    const { page, org, project, environment } = await aProjectWithLines(context, 40)

    await page.goto(`/${org}/${project}/logs?env=${environment}&period=1h`)
    await expect(page.locator('canvas').first()).toBeVisible()
    const light = await canvasOf(page)

    await page.getByRole('button', { name: 'Dark' }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)

    await expect
      .poll(async () => (await canvasOf(page)) !== light, {
        message: 'the chart is still painted with the light palette',
      })
      .toBe(true)
  })

  test('draws nothing to mislead anyone when there is nothing', async ({ context }) => {
    const { page, org, project, environment } = await aProjectWithLines(context, 3)

    await page.goto(`/${org}/${project}/logs?env=${environment}&period=15m`)

    const chart = page.getByRole('region', { name: /volume/i })
    await expect(chart.getByText('no lines in this period')).toBeVisible()
  })

  test('never lets the caller choose how wide a bar is', async ({ context }) => {
    const { page, org, project, environment } = await aProjectWithLines(context, 3)

    const answer = await api(
      page,
      `/api/orgs/${org}/projects/${project}/logs/histogram?env=${environment}&from=${WIDE.from}&to=${WIDE.to}&bucket=1m`,
    )

    expect(answer.status).toBe(400)
    expect(answer.body?.error).toBe('unknown_parameter')
  })

  test('picks the bucket from the period and says which one it picked', async ({ context }) => {
    const { page, org, project, environment } = await aProjectWithLines(context, 3)
    const where = `/api/orgs/${org}/projects/${project}/logs/histogram?env=${environment}`

    const hour = await api(
      page,
      `${where}&from=${new Date(Date.now() - 60 * 60 * 1000).toISOString()}&to=${WIDE.to}`,
    )
    const month = await api(
      page,
      `${where}&from=${new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()}&to=${WIDE.to}`,
    )

    expect(hour.body?.bucket).toBe('1m')
    expect(month.body?.bucket, 'a month of one-minute bars is 43 200 of them').toBe('6h')
  })
})
