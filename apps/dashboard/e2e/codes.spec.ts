import { expect, test } from '@playwright/test'
import { BASE_URL } from '../playwright.config'
import { clearMail, codeFromMail } from './support/mail'
import {
  anAccount,
  api,
  closeWorld,
  cookieValue,
  openBrowser,
  PASSWORD,
  signIn,
  store,
} from './support/world'

test.afterAll(async () => {
  await closeWorld()
})

test('a code that is gone sends the person back to the start', async ({ context }) => {
  const page = await openBrowser(context)
  const email = await anAccount(page)

  await clearMail(email)
  await api(page, '/api/auth/login/start', { email, password: PASSWORD })
  const code = await codeFromMail(email, 'Your sign-in code')

  const challenge = await cookieValue(context, '__Host-lc')
  const userId = (challenge ?? '').split('.')[0] as string
  await store().del(`otp:login:${userId}`)

  const answer = await api(page, '/api/auth/login/verify', { code, remember: true })

  expect(answer.status).toBe(401)
  expect(answer.body).toEqual({ error: 'start_again' })
})

test('a code works once, and the second time it is gone', async ({ context }) => {
  const page = await openBrowser(context)
  const email = await anAccount(page)

  await clearMail(email)
  await api(page, '/api/auth/login/start', { email, password: PASSWORD })
  const code = await codeFromMail(email, 'Your sign-in code')

  expect((await api(page, '/api/auth/login/verify', { code, remember: true })).status).toBe(200)
  expect(await cookieValue(context, '__Host-at')).toBeDefined()

  const twice = await api(page, '/api/auth/login/verify', { code, remember: true })
  expect(twice.status).toBe(401)
})

test('the fifth wrong code ends the attempt, and the sixth has nothing to answer', async ({
  context,
}) => {
  const page = await openBrowser(context)
  const email = await anAccount(page)
  await api(page, '/api/auth/login/start', { email, password: PASSWORD })

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const wrong = await api(page, '/api/auth/login/verify', { code: 'AAA-AAA', remember: true })
    expect(wrong.body, `attempt ${attempt}`).toEqual({ error: 'wrong_code' })
  }

  const fifth = await api(page, '/api/auth/login/verify', { code: 'AAA-AAA', remember: true })
  expect(fifth.body, 'the fifth wrong code should end the attempt').toEqual({
    error: 'start_again',
  })

  const sixth = await api(page, '/api/auth/login/verify', { code: 'AAA-AAA', remember: true })
  expect(sixth.body).toEqual({ error: 'start_again' })
})

test('a code from one browser is worth nothing in another', async ({ context, browser }) => {
  const page = await openBrowser(context)
  const email = await anAccount(page)

  await clearMail(email)
  await api(page, '/api/auth/login/start', { email, password: PASSWORD })
  const code = await codeFromMail(email, 'Your sign-in code')

  const other = await browser.newContext()
  const elsewhere = await openBrowser(other)
  const refused = await api(elsewhere, '/api/auth/login/verify', { code, remember: true })

  expect(refused.status).toBe(401)
  expect(refused.body, 'telling the two apart would say whether a code is in flight').toEqual({
    error: 'start_again',
  })
  expect(await cookieValue(other, '__Host-at')).toBeUndefined()

  await other.close()
})

test('a resend inside the minute is told to wait', async ({ context }) => {
  const page = await openBrowser(context)
  const email = await anAccount(page)
  await api(page, '/api/auth/login/start', { email, password: PASSWORD })

  const held = await api(page, '/api/auth/login/resend', {})

  expect(held.status).toBe(429)
  expect(Number(held.retryAfter)).toBeGreaterThan(0)
})

test('the sixth send in an hour is refused even once the minute has passed', async ({
  context,
}) => {
  const page = await openBrowser(context)
  const email = await anAccount(page)
  await api(page, '/api/auth/login/start', { email, password: PASSWORD })

  const challenge = await cookieValue(context, '__Host-lc')
  const userId = (challenge ?? '').split('.')[0] as string

  for (let send = 2; send <= 5; send += 1) {
    await store().del(`otp:cooldown:login:${userId}`)
    const again = await api(page, '/api/auth/login/resend', {})
    expect(again.status, `send ${send}`).toBe(200)
  }

  await store().del(`otp:cooldown:login:${userId}`)
  const sixth = await api(page, '/api/auth/login/resend', {})

  expect(sixth.status).toBe(429)
})

test('a browser that signed in carries cookies no script can read', async ({ context }) => {
  const page = await openBrowser(context)
  const email = await anAccount(page)
  expect((await signIn(page, email)).status).toBe(200)

  const cookies = await context.cookies(BASE_URL)
  const access = cookies.find((cookie) => cookie.name === '__Host-at')

  expect(access?.httpOnly).toBe(true)
  expect(access?.secure).toBe(true)
  expect(access?.path).toBe('/')
  expect(access?.sameSite).toBe('Lax')
  expect(await page.evaluate(() => document.cookie)).not.toContain('__Host-')
})
