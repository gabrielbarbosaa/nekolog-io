import { expect, test } from '@playwright/test'
import { BASE_URL } from '../playwright.config'
import { clearMail, codeFromMail } from './support/mail'
import {
  anAddress,
  anInvitedAddress,
  closeWorld,
  forgetTheCodeWait,
  PASSWORD,
} from './support/world'

test.afterAll(async () => {
  await closeWorld()
})

test('somebody invited can sign up, confirm and sign in, all on the screen', async ({ page }) => {
  const { email, token } = await anInvitedAddress()
  await clearMail(email)

  await page.goto(`${BASE_URL}/signup?invite=${token}`)
  await page.getByLabel(/your name|seu nome|tu nombre/i).fill('The Newcomer')
  await page.getByLabel(/^password$|^senha$|^contraseña$/i).fill(PASSWORD)
  await page.getByRole('button', { name: /continue|continuar|seguir/i }).click()

  await expect(page.getByLabel(/code|código/i)).toBeVisible()
  await page.getByLabel(/code|código/i).fill(await codeFromMail(email, 'Confirm your e-mail'))
  await page.getByRole('button', { name: /confirm|confirmar/i }).click()

  await expect(page.getByRole('link', { name: /sign in|entrar/i })).toBeVisible()

  await forgetTheCodeWait(email)
  await clearMail(email)
  await page.goto(`${BASE_URL}/login`)
  await page.getByLabel(/e-mail/i).fill(email)
  await page.getByLabel(/^password$|^senha$|^contraseña$/i).fill(PASSWORD)
  await page.getByRole('button', { name: /continue|continuar|seguir/i }).click()

  await page.getByLabel(/code|código/i).fill(await codeFromMail(email, 'Your sign-in code'))
  await page.getByRole('button', { name: /^sign in$|^entrar$/i }).click()

  await expect(page.getByRole('heading', { name: /projects|projetos|proyectos/i })).toBeVisible()
})

test('a wrong password says so and does not move on', async ({ page }) => {
  const { email, token } = await anInvitedAddress()
  await clearMail(email)

  await page.goto(`${BASE_URL}/signup?invite=${token}`)
  await page.getByLabel(/your name|seu nome|tu nombre/i).fill('The Newcomer')
  await page.getByLabel(/^password$|^senha$|^contraseña$/i).fill(PASSWORD)
  await page.getByRole('button', { name: /continue|continuar|seguir/i }).click()
  await page.getByLabel(/code|código/i).fill(await codeFromMail(email, 'Confirm your e-mail'))
  await page.getByRole('button', { name: /confirm|confirmar/i }).click()
  await expect(page.getByRole('link', { name: /sign in|entrar/i })).toBeVisible()

  await page.goto(`${BASE_URL}/login`)
  await page.getByLabel(/e-mail/i).fill(email)
  await page.getByLabel(/^password$|^senha$|^contraseña$/i).fill('not the password')
  await page.getByRole('button', { name: /continue|continuar|seguir/i }).click()

  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByLabel(/^password$|^senha$|^contraseña$/i)).toBeVisible()
})

test('signing up needs an invitation, and the page says so', async ({ page }) => {
  await page.goto(`${BASE_URL}/signup`)

  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByLabel(/your name|seu nome|tu nombre/i)).toHaveCount(0)
})

test('a visitor with no session is sent to the sign-in screen', async ({ page }) => {
  await page.goto(`${BASE_URL}/`)

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: /sign in|entrar/i })).toBeVisible()
})

test('recovering a password walks from one screen to the next', async ({ page }) => {
  await page.goto(`${BASE_URL}/login`)
  await page.getByRole('link', { name: /forgot|esqueceu|olvidaste/i }).click()

  await expect(page).toHaveURL(/forgot-password$/)
  await page.getByLabel(/e-mail/i).fill(anAddress())
  await page.getByRole('button', { name: /continue|continuar|seguir/i }).click()

  await expect(page.getByRole('status')).toBeVisible()
  await page.getByRole('link', { name: /continue|continuar|seguir/i }).click()
  await expect(page).toHaveURL(/reset-password$/)
})
