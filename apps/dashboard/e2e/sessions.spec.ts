import { expect, test } from '@playwright/test'
import { BASE_URL } from '../playwright.config'
import { clearMail, codeFromMail, waitForMail } from './support/mail'
import {
  anAccount,
  api,
  closeWorld,
  cookieValue,
  forgetTheCodeWait,
  openBrowser,
  PASSWORD,
  sessionIdOf,
  signIn,
  store,
} from './support/world'

test.afterAll(async () => {
  await closeWorld()
})

test('the access token renews itself when the browser no longer holds one', async ({ context }) => {
  const page = await openBrowser(context)
  const email = await anAccount(page)
  expect((await signIn(page, email)).status).toBe(200)

  const refresh = await cookieValue(context, '__Host-rt')
  await context.clearCookies({ name: '__Host-at' })
  expect(await cookieValue(context, '__Host-at')).toBeUndefined()

  const listed = await api(page, '/api/auth/sessions')

  expect(listed.status, 'the request should have been renewed on its way in').toBe(200)
  expect(
    await cookieValue(context, '__Host-at'),
    'the proxy should have written a new access token',
  ).toBeDefined()
  expect(
    await cookieValue(context, '__Host-rt'),
    'and rotated the refresh token while it was there',
  ).not.toBe(refresh)
})

test('ten requests sharing one refresh token keep the session alive', async ({ context }) => {
  const page = await openBrowser(context)
  const email = await anAccount(page)
  expect((await signIn(page, email)).status).toBe(200)
  const sid = await sessionIdOf(context)

  const answers = await page.evaluate(async () => {
    const calls = Array.from({ length: 10 }, () =>
      fetch('/api/auth/refresh', { method: 'POST' }).then((response) => response.status),
    )
    return Promise.all(calls)
  })

  expect(
    answers.filter((status) => status !== 200),
    JSON.stringify(answers),
  ).toEqual([])
  expect(await store().exists(`sess:${sid}`)).toBe(1)
  expect((await api(page, '/api/auth/sessions')).status).toBe(200)
})

test('a refresh token used again after the grace window is caught by the proxy', async ({
  context,
}) => {
  const page = await openBrowser(context)
  const email = await anAccount(page)
  expect((await signIn(page, email)).status).toBe(200)

  const sid = await sessionIdOf(context)
  const stolen = (await cookieValue(context, '__Host-rt')) as string

  await context.clearCookies({ name: '__Host-at' })
  const rotated = await api(page, '/api/auth/refresh', {})
  expect(rotated.status, JSON.stringify(rotated.body)).toBe(200)
  expect(await cookieValue(context, '__Host-rt')).not.toBe(stolen)

  await context.addCookies([
    {
      name: '__Host-rt',
      value: stolen,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ])
  expect(await cookieValue(context, '__Host-rt')).toBe(stolen)
  await context.clearCookies({ name: '__Host-at' })
  await store().hset(`sess:${sid}`, 'prevUntil', '0')
  await clearMail(email)

  const caught = await api(page, '/api/auth/refresh', {})

  expect(caught.status).toBe(401)
  expect(
    caught.body,
    'the proxy renews before any route runs, so it is what sees the reuse and clears the cookies',
  ).toEqual({ error: 'signed_out' })
  expect(await store().exists(`sess:${sid}`)).toBe(0)
  expect(await cookieValue(context, '__Host-rt')).toBeUndefined()
  expect(await cookieValue(context, '__Host-at')).toBeUndefined()

  const warning = await waitForMail(email, 'signed one of your devices out')
  expect(warning.text).not.toContain('http')
})

test('a session past the thirty-day ceiling cannot renew', async ({ context }) => {
  const page = await openBrowser(context)
  const email = await anAccount(page)
  expect((await signIn(page, email)).status).toBe(200)

  const sid = await sessionIdOf(context)
  await store().hset(`sess:${sid}`, 'absExp', String(Date.now() - 1000))
  await context.clearCookies({ name: '__Host-at' })

  const over = await api(page, '/api/auth/refresh', {})

  expect(over.status).toBe(401)
  expect(await store().exists(`sess:${sid}`)).toBe(0)
})

test('signing out everywhere reaches the other browser at once', async ({ context, browser }) => {
  const here = await openBrowser(context)
  const email = await anAccount(here)
  expect((await signIn(here, email)).status).toBe(200)

  const other = await browser.newContext()
  const there = await openBrowser(other)
  await forgetTheCodeWait(email)
  const second = await signIn(there, email)
  expect(second.status, JSON.stringify(second.body)).toBe(200)
  expect((await api(there, '/api/auth/sessions')).status).toBe(200)

  expect((await api(here, '/api/auth/logout-all', {})).status).toBe(200)

  expect(
    (await api(there, '/api/auth/sessions')).status,
    'the other browser still held an access token that had not run out',
  ).toBe(401)

  await other.close()
})

test('recovering a password ends the sessions of every browser', async ({ context, browser }) => {
  const here = await openBrowser(context)
  const email = await anAccount(here)
  expect((await signIn(here, email)).status).toBe(200)

  const other = await browser.newContext()
  const there = await openBrowser(other)
  await clearMail(email)
  expect((await api(there, '/api/auth/password/forgot', { email })).status).toBe(200)
  const code = await codeFromMail(email, 'set a new password')

  const reset = await api(there, '/api/auth/password/reset', {
    code,
    password: 'a recovered password of a legal length',
  })
  expect(reset.status, JSON.stringify(reset.body)).toBe(200)

  expect(
    (await api(here, '/api/auth/sessions')).status,
    'the browser that was already signed in should be out',
  ).toBe(401)

  await other.close()
})

test('a sensitive action is barred the moment the session is revoked', async ({ context }) => {
  const page = await openBrowser(context)
  const email = await anAccount(page)
  expect((await signIn(page, email)).status).toBe(200)

  const listed = await api(page, '/api/auth/sessions')
  const sessions = (listed.body?.sessions ?? []) as Array<{ sid: string; current: boolean }>
  const current = sessions.find((session) => session.current)
  expect(current).toBeDefined()

  expect((await api(page, '/api/auth/sessions', { sid: current?.sid })).status).toBe(200)
  expect(await cookieValue(context, '__Host-at'), 'the token itself is still valid').toBeDefined()

  const barred = await api(page, '/api/auth/sessions')
  expect(barred.status).toBe(401)
})

test('a password that is right inside the resend window says wait, not invalid', async ({
  context,
}) => {
  const page = await openBrowser(context)
  const email = await anAccount(page)
  expect((await signIn(page, email)).status).toBe(200)

  const held = await api(page, '/api/auth/login/start', { email, password: PASSWORD })

  expect(held.status).toBe(429)
  expect(Number(held.retryAfter)).toBeGreaterThan(0)
})
