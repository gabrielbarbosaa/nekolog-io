import { expect, type Page, test } from '@playwright/test'
import { aProjectWithLines, clickHouseAnswers, type Line, writeLines } from './support/lines'
import { closeWorld } from './support/world'

function timeline(page: Page) {
  return page.getByRole('list', { name: /oldest first|mais antigo|más antiguo/i })
}

function steps(page: Page) {
  return timeline(page).getByRole('listitem')
}

test.afterAll(async () => {
  await closeWorld()
})

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736'
const OTHER = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

function stamp(value: Date): string {
  return value.toISOString().replace('T', ' ').replace('Z', '')
}

function theJourney(start: Date): Line[] {
  const at = (ms: number) => stamp(new Date(start.getTime() + ms))

  return [
    {
      timestamp: at(0),
      level: 'info',
      message: 'the shopper pressed pay',
      service: 'checkout-web',
      source: 'browser',
      traceId: TRACE,
      spanId: '00f067aa0ba902b7',
    },
    {
      timestamp: at(120),
      level: 'info',
      message: 'POST /orders came in',
      service: 'checkout-api',
      source: 'node',
      traceId: TRACE,
      spanId: '00f067aa0ba902b8',
    },
    {
      timestamp: at(900),
      level: 'error',
      message: 'the gateway never answered',
      service: 'payments',
      source: 'node',
      traceId: TRACE,
      spanId: '00f067aa0ba902b9',
    },
    {
      timestamp: at(60),
      level: 'info',
      message: 'somebody else entirely',
      service: 'checkout-api',
      source: 'node',
      traceId: OTHER,
      spanId: '00f067aa0ba902ba',
    },
  ]
}

test.describe('the trace view', () => {
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

  test('puts the click in the front and the request in the back on one timeline', async ({
    context,
  }) => {
    const { page, org, project, environment } = await aProjectWithLines(context, 5)
    const start = new Date(Date.now() - 10 * 60 * 1000)
    await writeLines(project, environment, theJourney(start))

    await page.goto(`/${org}/${project}/traces/${TRACE}?at=${start.toISOString()}`)

    await expect(steps(page)).toHaveCount(3)
    await expect(page.getByText('the shopper pressed pay')).toBeVisible()
    await expect(page.getByText('POST /orders came in')).toBeVisible()
    await expect(page.getByText('the gateway never answered')).toBeVisible()
    await expect(page.getByText('somebody else entirely')).toHaveCount(0)

    const read = await steps(page).allInnerTexts()
    expect(read[0]).toContain('checkout-web')
    expect(read[0]).toContain('browser')
    expect(read[1]).toContain('checkout-api')
    expect(read[2]).toContain('payments')
  })

  test('counts each step from the first one', async ({ context }) => {
    const { page, org, project, environment } = await aProjectWithLines(context, 5)
    const start = new Date(Date.now() - 10 * 60 * 1000)
    await writeLines(project, environment, theJourney(start))

    await page.goto(`/${org}/${project}/traces/${TRACE}?at=${start.toISOString()}`)

    const read = await steps(page).allInnerTexts()
    expect(read[0]).toContain('+0ms')
    expect(read[1]).toContain('+120ms')
    expect(read[2]).toContain('+900ms')
  })

  test('is reached by clicking the trace of a log in the explorer', async ({ context }) => {
    const { page, org, project, environment } = await aProjectWithLines(context, 5)
    const start = new Date(Date.now() - 10 * 60 * 1000)
    await writeLines(project, environment, theJourney(start))

    await page.goto(`/${org}/${project}/logs?env=${environment}&period=1h`)
    await page.getByText('the gateway never answered').click()

    await page.getByRole('link', { name: TRACE }).click()

    await expect(page).toHaveURL(new RegExp(`/traces/${TRACE}`))
    await expect(page.getByText('the shopper pressed pay')).toBeVisible()
  })

  test('says so rather than showing an empty page when nothing carries the trace', async ({
    context,
  }) => {
    const { page, org, project } = await aProjectWithLines(context, 5)

    await page.goto(`/${org}/${project}/traces/${OTHER}`)

    await expect(page.getByRole('status')).toBeVisible()
    await expect(timeline(page)).toHaveCount(0)
  })

  test('answers 404 for something that is not a trace id', async ({ context }) => {
    const { page, org, project } = await aProjectWithLines(context, 5)

    await page.goto(`/${org}/${project}/traces/not-a-trace`)

    await expect(page.getByText(/not found|404/i).first()).toBeVisible()
  })
})
