import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { BASE_URL } from '../playwright.config'
import { clearMail, codeFromMail } from './support/mail'
import { anInvitedAddress, closeWorld, PASSWORD } from './support/world'

test.afterAll(async () => {
  await closeWorld()
})

async function signedIn(page: Page): Promise<void> {
  const { email, token } = await anInvitedAddress('admin')
  await clearMail(email)

  await page.goto(`${BASE_URL}/signup?invite=${token}`)
  await page.getByLabel(/your name/i).fill('Ada Lovelace')
  await page.getByLabel(/^password$/i).fill(PASSWORD)
  await page.getByRole('button', { name: /continue/i }).click()
  await page.getByLabel(/code/i).fill(await codeFromMail(email, 'Confirm your e-mail'))
  await page.getByRole('button', { name: /confirm/i }).click()
  await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible()

  await clearMail(email)
  await page.goto(`${BASE_URL}/login`)
  await page.getByLabel(/e-mail/i).fill(email)
  await page.getByLabel(/^password$/i).fill(PASSWORD)
  await page.getByRole('button', { name: /continue/i }).click()
  await page.getByLabel(/code/i).fill(await codeFromMail(email, 'Your sign-in code'))
  await page.getByRole('button', { name: /^sign in$/i }).click()
  await expect(page.getByRole('heading', { name: /projects/i })).toBeVisible()
}

test('what the screens look like', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 })

  await page.goto(`${BASE_URL}/login`)
  await page.screenshot({ path: 'test-results/look-login.png' })

  await page.emulateMedia({ colorScheme: 'dark' })
  await page.reload()
  await page.screenshot({ path: 'test-results/look-login-dark.png' })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.reload()

  await signedIn(page)
  await page.screenshot({ path: 'test-results/look-projects-empty.png' })

  await page.getByLabel(/^name$/i).fill('Checkout')
  await page.getByRole('button', { name: /create project/i }).click()
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible()
  await page.screenshot({ path: 'test-results/look-project-settings.png' })

  await page
    .getByRole('button', { name: /production/ })
    .filter({ hasText: /secret/i })
    .click()
  await expect(page.getByText(/^nekolog_sk_/)).toBeVisible()
  await page.screenshot({ path: 'test-results/look-key-once.png' })

  await page.getByRole('button', { name: /i have it/i }).click()
  await page
    .getByRole('button', { name: /production/ })
    .first()
    .click()
  await page.screenshot({ path: 'test-results/look-environment.png' })

  await page.getByRole('link', { name: /^members$/i }).click()
  await expect(page.getByRole('heading', { name: /members/i })).toBeVisible()
  await page.screenshot({ path: 'test-results/look-members.png' })

  await page.getByRole('link', { name: /^account$/i }).click()
  await expect(page.getByText(/this browser/i)).toBeVisible()
  await page.screenshot({ path: 'test-results/look-account.png' })
})
