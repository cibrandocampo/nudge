import { expect } from '@playwright/test'
import { goToSettings } from './navigation.js'
import { expectInContactList, expectLanguage, expectNotInContactList } from './assertions.js'

export async function changeTimezone(page, tzName) {
  await goToSettings(page)
  const input = page.getByPlaceholder('Search timezone…')
  await input.click()
  await input.fill(tzName)
  await page.getByRole('option', { name: tzName, exact: true }).click()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('button', { name: 'Saved!' })).toBeVisible()
}

/**
 * Change UI language via the Settings select. `lang` is 'en' | 'es' | 'gl'.
 */
export async function changeLanguage(page, lang) {
  await goToSettings(page)
  const select = page.getByLabel(/language/i)
  await select.selectOption(lang)
  await expectLanguage(page, lang)
}

export async function addContact(page, username) {
  await goToSettings(page)
  const input = page.getByPlaceholder(/search users/i)
  await input.click()
  await input.fill(username)
  await page.getByRole('option', { name: username, exact: true }).click()
  await expectInContactList(page, username)
}

export async function removeContact(page, username) {
  await goToSettings(page)
  const row = page.getByRole('listitem').filter({ hasText: username })
  await row.getByRole('button', { name: 'Remove' }).click()
  await expectNotInContactList(page, username)
}

/**
 * Grant push permission must be configured at the context level before
 * calling this (e.g. `await context.grantPermissions(['notifications'])`).
 */
export async function enablePush(page) {
  await goToSettings(page)
  await page.getByRole('button', { name: /enable push|subscribe/i }).click()
}

export async function disablePush(page) {
  await goToSettings(page)
  await page.getByRole('button', { name: /disable push|unsubscribe/i }).click()
}

export async function sendTestNotification(page) {
  await goToSettings(page)
  await page.getByRole('button', { name: /send test/i }).click()
}
