// Web e2e scenario: the web-access picker card in Plugins settings — both radio
// lists over the `web` namespace with their «Авто» options, the providers this
// deployment does not mount rendered grey with their tag, and a pick opening the
// matching provider card down to the settings document. Zero model calls:
// everything is client state plus the settings document on a blank frame, so
// there is no fixture and a stray stream would fail loud on the open llm seam.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/web-access-settings', import.meta.url))
const PICKER_EXPECTED = join(SNAPSHOT_DIR, 'picker.expected.md')
const MODE = webSnapshotMode()

// Mirrored provider module names (this lane imports no client package; drift
// makes the greyness assertion disagree with what the picker greys).
const PROVIDER_MODULES = [
  '@deepseek-ai/dsh-web-search-deepseek',
  '@deepseek-ai/dsh-web-search-zai',
  '@deepseek-ai/dsh-web-search-exa',
  '@deepseek-ai/dsh-web-search-perplexity',
  '@deepseek-ai/dsh-web-fetch-http',
] as const

describe('web e2e: web-access provider picker', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 } })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  /**
   * Open the settings dialog on the Plugins section. The scenarios share one
   * page so the settings document accumulates across them, so this leaves any
   * dialog a previous scenario opened closed first — its mask would otherwise
   * swallow the trigger click.
   */
  async function openPlugins() {
    if (await page.getByRole('dialog', { name: 'Настройки' }).count() > 0) {
      await page.keyboard.press('Escape')
      await expect.poll(() => page.getByRole('dialog', { name: 'Настройки' }).count(), { timeout: 5_000 }).toBe(0)
    }
    await page.getByRole('button', { name: 'Настройки', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Настройки' })
    await dialog.waitFor({ timeout: 10_000 })
    await dialog.getByRole('button', { name: 'Плагины', exact: true }).click()
    await expect
      .poll(() => dialog.getByRole('button', { name: 'Плагины', exact: true }).getAttribute('aria-current'), { timeout: 5_000 })
      .toBe('true')
    await expect
      .poll(() => dialog.getByRole('tab', { name: 'Конфигурация плагинов', exact: true }).getAttribute('aria-selected'), { timeout: 5_000 })
      .toBe('true')
    return dialog
  }

  /** The picker card inside the dialog, addressed by its header. */
  function pickerCard(dialog: Locator) {
    return dialog.locator('li').filter({ has: page.getByRole('button', { name: /Веб-доступ/ }) })
  }

  /** The Exa provider card inside the dialog, addressed by its header. */
  function exaCard(dialog: Locator) {
    return dialog.locator('li').filter({ has: page.getByRole('button', { name: 'Веб-поиск Exa' }) })
  }

  /** The settings document as the Host has written it so far. */
  async function settingsDocument(): Promise<string> {
    return readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8').catch(() => '')
  }

  /** The mounted plugin module names, from the same Loader read the Host serves. */
  function mountedModules(): ReadonlySet<string> {
    const names = new Set<string>()
    for (const entry of scaffold.ctx.loader.entries()) {
      if (entry.options.group) continue
      names.add(entry.options.name)
    }
    return names
  }

  it('shows both picker groups with every provider and the auto option', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-web-access-picker'))
    const dialog = await openPlugins()
    await dialog.getByText('Веб-доступ', { exact: true }).click()

    const picker = pickerCard(dialog)
    const searchGroup = picker.getByRole('group', { name: 'Поиск', exact: true })
    const fetchGroup = picker.getByRole('group', { name: 'Загрузка страниц', exact: true })
    await searchGroup.waitFor({ timeout: 10_000 })

    // Every search provider the seam knows, mounted or not, plus one «Авто»
    // per group. An unmounted option's accessible name carries its tag, so
    // the match anchors on the name's head.
    for (const name of ['DeepSeek', 'Z\.ai', 'Exa', 'Perplexity']) {
      expect(await searchGroup.getByRole('radio', { name: new RegExp(`^${name}`) }).count()).toBe(1)
    }
    expect(await fetchGroup.getByRole('radio', { name: /^HTTP/ }).count()).toBe(1)
    expect(await searchGroup.getByRole('radio', { name: 'Авто', exact: true }).count()).toBe(1)
    expect(await fetchGroup.getByRole('radio', { name: 'Авто', exact: true }).count()).toBe(1)

    // Greyness tells the deployment's truth: one tag per provider whose
    // plugin this composition does not mount, computed from the same Loader
    // read the Host inventory serves.
    const mounted = mountedModules()
    const unmounted = PROVIDER_MODULES.filter(name => !mounted.has(name)).length
    expect(await dialog.getByText('плагин не подключён').count()).toBe(unmounted)
    // The shipped composition carries z.ai, so its row is never grey.
    const zaiLabel = searchGroup.locator('label').filter({ has: page.getByRole('radio', { name: /^Z\.ai$/ }) })
    expect(await zaiLabel.getByText('плагин не подключён').count()).toBe(0)

    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(PICKER_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('opens the picked provider card and writes the pick on save', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-web-access-pick'))
    const dialog = await openPlugins()
    const picker = pickerCard(dialog)
    // The card body renders only while the card is disclosed.
    await picker.getByRole('button', { name: /Веб-доступ/ }).click()
    await picker.getByRole('group', { name: 'Поиск', exact: true }).waitFor({ timeout: 10_000 })

    // The composed default already checks Z.ai, so the pick moves to Exa — a
    // real selection change, whose save has something to write.
    await picker.getByRole('radio', { name: 'Exa' }).click()

    // The pick opens and highlights the matching provider card before any
    // save: the choice, not the write, is what the reader follows.
    await expect
      .poll(() => exaCard(dialog).getByRole('button', { name: 'Веб-поиск Exa' }).getAttribute('aria-expanded'), { timeout: 5_000 })
      .toBe('true')
    // Nothing crosses the wire until the user saves.
    expect(await settingsDocument()).not.toContain('searchProvider')
    await picker.getByRole('button', { name: 'Сохранить', exact: true }).click()

    await expect.poll(async () => (await settingsDocument()).includes('searchProvider: exa'), { timeout: 10_000 })
      .toBe(true)
    expect(await picker.getByRole('radio', { name: 'Exa' }).isChecked()).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('returns the composed selection when the user layer is cleared', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-web-access-auto'))
    const dialog = await openPlugins()
    const picker = pickerCard(dialog)
    const searchGroup = picker.getByRole('group', { name: 'Поиск', exact: true })
    // The card body renders only while the card is disclosed.
    await picker.getByRole('button', { name: /Веб-доступ/ }).click()
    await searchGroup.waitFor({ timeout: 10_000 })

    // «Авто» stages the empty string; the save unsets the user layer, and the
    // selection falls back to what the composition carries.
    await searchGroup.getByRole('radio', { name: 'Авто', exact: true }).check()
    await picker.getByRole('button', { name: 'Сохранить', exact: true }).click()

    await expect.poll(async () => (await settingsDocument()).includes('searchProvider'), { timeout: 10_000 })
      .toBe(false)
    // The composed default (zai, from the shipped bundle) answers again.
    await expect.poll(() => searchGroup.getByRole('radio', { name: 'Z.ai' }).isChecked(), { timeout: 5_000 })
      .toBe(true)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['picker.expected.md'])
  })
})
