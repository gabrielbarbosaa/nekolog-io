import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { BASE_URL } from '../playwright.config'
import { clearMail, codeFromMail } from './support/mail'
import { anAddress, anInvitedAddress, closeWorld, PASSWORD } from './support/world'

test.afterAll(async () => {
  await closeWorld()
})

async function anAccountOnScreen(page: Page): Promise<string> {
  const { email, token } = await anInvitedAddress('admin')
  await clearMail(email)

  await page.goto(`${BASE_URL}/signup?invite=${token}`)
  await page.getByLabel(/your name|seu nome|tu nombre/i).fill('The Operator')
  await page.getByLabel(/^password$|^senha$|^contraseña$/i).fill(PASSWORD)
  await page.getByRole('button', { name: /continue|continuar|seguir/i }).click()
  await page.getByLabel(/code|código/i).fill(await codeFromMail(email, 'Confirm your e-mail'))
  await page.getByRole('button', { name: /confirm|confirmar/i }).click()
  await expect(page.getByRole('link', { name: /sign in|entrar/i })).toBeVisible()

  await clearMail(email)
  await page.goto(`${BASE_URL}/login`)
  await page.getByLabel(/e-mail/i).fill(email)
  await page.getByLabel(/^password$|^senha$|^contraseña$/i).fill(PASSWORD)
  await page.getByRole('button', { name: /continue|continuar|seguir/i }).click()
  await page.getByLabel(/code|código/i).fill(await codeFromMail(email, 'Your sign-in code'))
  await page.getByRole('button', { name: /^sign in$|^entrar$/i }).click()
  await expect(page.getByRole('heading', { name: /projects|projetos/i })).toBeVisible()

  return email
}

async function aProject(page: Page, name: string): Promise<void> {
  await page.getByLabel(/^name$|^nome$|^nombre$/i).fill(name)
  await page.getByRole('button', { name: /create project|criar projeto|crear proyecto/i }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
}

test('creating a project lands on its settings, with the three environments', async ({ page }) => {
  await anAccountOnScreen(page)
  await aProject(page, 'The Shop')

  for (const name of ['production', 'staging', 'development']) {
    await expect(page.getByRole('button', { name, exact: false }).first()).toBeVisible()
  }
})

test('a key is minted on screen and shown exactly once', async ({ page }) => {
  await anAccountOnScreen(page)
  await aProject(page, 'Keys Shop')

  await page
    .getByRole('button', { name: /production/ })
    .filter({ hasText: /secret|secreta/i })
    .click()

  const shown = page.getByText(/^nekolog_sk_/)
  await expect(shown).toBeVisible()
  const value = (await shown.textContent()) ?? ''
  expect(value.startsWith('nekolog_sk_')).toBe(true)

  await page.getByRole('button', { name: /i have it|já copiei|ya la tengo/i }).click()
  await expect(page.getByText(value, { exact: true })).toHaveCount(0)
  await expect(page.getByText(`nekolog_sk_…${value.slice(-4)}`)).toBeVisible()

  await page.reload()
  await expect(page.getByText(value, { exact: true })).toHaveCount(0)
})

test('an environment setting is saved and comes back changed', async ({ page }) => {
  await anAccountOnScreen(page)
  await aProject(page, 'Retention Shop')

  await page
    .getByRole('button', { name: /production/ })
    .first()
    .click()
  const retention = page.getByLabel(/retention|retenção|retención/i)
  await retention.fill('21')
  await page.getByRole('button', { name: /^save$|^salvar$|^guardar$/i }).click()

  await expect(page.getByRole('status')).toBeVisible()
  await page.reload()
  await page
    .getByRole('button', { name: /production/ })
    .first()
    .click()
  await expect(page.getByLabel(/retention|retenção|retención/i)).toHaveValue('21')
})

test('the last environment cannot be removed from the screen either', async ({ page }) => {
  await anAccountOnScreen(page)
  await aProject(page, 'One Left')

  for (const name of ['staging', 'development']) {
    await page.getByRole('button', { name, exact: false }).first().click()
    await page
      .getByRole('button', { name: /^remove$|^remover$|^quitar$/i })
      .first()
      .click()
    await expect(page.getByRole('button', { name, exact: false })).toHaveCount(0)
  }

  await page
    .getByRole('button', { name: /production/ })
    .first()
    .click()
  await expect(page.getByRole('button', { name: /^remove$|^remover$|^quitar$/i })).toBeDisabled()
})

test('inviting somebody shows them in the waiting list', async ({ page }) => {
  await anAccountOnScreen(page)

  await page.getByRole('link', { name: /^members$|^membros$|^miembros$/i }).click()
  await expect(page.getByRole('heading', { name: /members|membros|miembros/i })).toBeVisible()

  const guest = anAddress()
  await page.getByLabel(/e-mail/i).fill(guest)
  await page.getByRole('button', { name: /^invite$|^convidar$|^invitar$/i }).click()

  await expect(page.getByRole('status')).toBeVisible()
  await expect(page.getByText(guest)).toBeVisible()
})

test('the account screen lists this browser among the sessions', async ({ page }) => {
  const email = await anAccountOnScreen(page)

  await page.getByRole('link', { name: /^account$|^conta$|^cuenta$/i }).click()
  await expect(page.getByText(email)).toBeVisible()
  await expect(page.getByText(/this browser|este navegador/i)).toBeVisible()
})
