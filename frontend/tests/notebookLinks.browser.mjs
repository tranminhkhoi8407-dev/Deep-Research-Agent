import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = process.env.NEXORA_PLAYWRIGHT_DIR ? require(path.join(process.env.NEXORA_PLAYWRIGHT_DIR, 'playwright')) : await import('playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.NEXORA_BROWSER_EXECUTABLE ? { executablePath: process.env.NEXORA_BROWSER_EXECUTABLE } : {}) });
const base = process.env.NEXORA_TEST_URL || 'http://127.0.0.1:5173', output = path.resolve('../tmp/notebook-links-qa');
await mkdir(output, { recursive: true });
const errors = [];
let page;
try {
  for (const theme of ['light', 'dark']) for (const lang of ['en', 'vi']) {
    const context = await browser.newContext({ viewport: { width: 1360, height: 840 } });
    page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && message.text().includes('occurred in the')) errors.push(message.text()); });
    await context.route('**/api/**', route => route.abort()); // Fixture replaces its APIs. Nothing reaches a real backend.
    await page.goto(`${base}/tests/fixtures/notebook-links.html?theme=${theme}&lang=${lang}`);
    const block = page.locator('[data-id="default-page-link"] .notebook-page-reference'), custom = page.locator('[data-id="custom-page-link"] .notebook-page-reference');
    await block.waitFor(); await custom.waitFor();
    const link = page.getByRole('button', { name: lang === 'vi' ? 'Chèn liên kết đến 124' : 'Insert page link: 124', exact: true });
    await link.waitFor();
    const style = await link.evaluate(element => { const value = getComputedStyle(element); return { radius: value.borderRadius, border: value.borderTopStyle, font: value.fontSize, color: value.backgroundColor, surface: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() }; });
    assert.equal(style.radius, '10px'); assert.equal(style.border, 'solid'); assert.equal(style.font, '13px'); assert.notEqual(style.color, 'rgb(239, 239, 239)', 'No native grey button background');
    assert.equal(await block.evaluate(element => getComputedStyle(element).borderRadius), '9px');
    const background = await block.evaluate(element => getComputedStyle(element).backgroundColor);
    await block.hover(); await page.waitForTimeout(200);
    assert.notEqual(await block.evaluate(element => getComputedStyle(element).backgroundColor), background, 'Default card has a subtle hover');
    assert.equal(await custom.evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)', 'User-selected block color stays transparent at card level');
    await custom.hover(); await page.waitForTimeout(200);
    assert.equal(await custom.evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)');
    await link.focus();
    assert.equal(await link.evaluate(element => getComputedStyle(element).outlineStyle), 'solid');
    await page.screenshot({ path: path.join(output, `${theme}-${lang}-desktop.png`) });
    await link.press('Enter');
    await page.waitForFunction(() => window.notebookLinksQA.inserted.includes('[124](#/collab/page/'));
    await block.getByRole('link', { name: '124', exact: true }).click();
    assert.equal(await page.evaluate(() => window.notebookLinksQA.opened), 'c'.repeat(32));
    await block.getByRole('button', { name: lang === 'vi' ? 'Tạo trang con trong 124' : 'Create a subpage in 124', exact: true }).click();
    assert.equal(await page.evaluate(() => window.notebookLinksQA.createdUnder), 'c'.repeat(32));
    await page.getByRole('button', { name: lang === 'vi' ? 'Mở trang liên kết: ff' : 'Open linked page: ff', exact: true }).click();
    assert.equal(await page.evaluate(() => window.notebookLinksQA.opened), 'a'.repeat(32));
    await page.setViewportSize({ width: 360, height: 820 });
    await page.screenshot({ path: path.join(output, `${theme}-${lang}-mobile.png`), fullPage: true });
    const fits = await page.locator('.notebook-link-item, .notebook-page-reference').evaluateAll(elements => elements.every(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth; }));
    assert(fits, 'Page cards must fit the narrow screen');
    const longTitle = page.locator('.notebook-link-item__title').nth(3);
    assert(await longTitle.evaluate(element => element.scrollWidth > element.clientWidth), 'Long titles truncate instead of widening the panel');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert(await block.evaluate(element => getComputedStyle(element).transitionDuration.split(',').every(value => parseFloat(value) <= .001)), 'Reduced-motion transitions are disabled or effectively instant');
    const blocks = await page.evaluate(() => window.notebookLinksQA.blocks);
    assert.equal(blocks.find(item => item.id === 'custom-page-link').props.backgroundColor, 'purple');
    assert.equal(blocks.find(item => item.id === 'custom-page-link').props.textColor, 'purple');
    // Also test the full project workspace: the original unstyled buttons
    // appeared here, outside .collab-hub's generic button selectors.
    await page.setViewportSize({ width: 1440, height: 980 });
    await page.goto(`${base}/tests/fixtures/projects.html?theme=${theme}&lang=${lang}#/collab/page/${'b'.repeat(32)}`);
    await page.locator('.field-inspector-toggle').click();
    const actualLink = page.locator('.notebook-sources .notebook-link-item').first();
    await actualLink.waitFor();
    assert.equal(await actualLink.evaluate(element => getComputedStyle(element).borderRadius), '10px');
    assert.equal(await actualLink.evaluate(element => getComputedStyle(element).fontSize), '13px');
    assert.equal(await actualLink.locator('.notebook-link-item__action svg').count(), 1);
    await page.screenshot({ path: path.join(output, `${theme}-${lang}-project-workspace.png`), fullPage: true });
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log('Page link styling passed: actual editor/source components, light/dark, VI/EN, 360px, keyboard focus, hover, long titles, insert/open/backlinks/subpage actions and preserved custom block colors. In-memory transport only.');
} catch (error) { if (page && !page.isClosed()) { await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }); console.error((await page.locator('body').innerText()).slice(-1200)); } throw error; }
finally { await browser.close(); }
