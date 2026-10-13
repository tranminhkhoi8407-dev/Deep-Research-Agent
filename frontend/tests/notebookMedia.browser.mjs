/* Actual editor, Yjs and in-memory image APIs. No user accounts or network imports. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = process.env.NEXORA_PLAYWRIGHT_DIR ? require(path.join(process.env.NEXORA_PLAYWRIGHT_DIR, 'playwright')) : await import('playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.NEXORA_BROWSER_EXECUTABLE ? { executablePath: process.env.NEXORA_BROWSER_EXECUTABLE } : {}) });
const base = process.env.NEXORA_TEST_URL || 'http://127.0.0.1:5173', root = 'b'.repeat(32), other = 'd'.repeat(32), folder = path.resolve('../tmp/notebook-media-qa');
await mkdir(folder, { recursive: true });
const errors = [], external = [];
let page;
async function pasteImage(page, drop = false) {
  await page.locator('.bn-editor [data-content-type="paragraph"]').nth(13).click();
  await page.evaluate(async drop => {
    const canvas = document.createElement('canvas'); canvas.width = 560; canvas.height = 180;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#eef4ff'; ctx.fillRect(0, 0, 560, 180); ctx.fillStyle = '#2b6ceb'; ctx.fillRect(30, 85, 90, 65); ctx.fillRect(150, 55, 90, 95); ctx.fillRect(270, 25, 90, 125); ctx.fillStyle = '#19304e'; ctx.font = '22px sans-serif'; ctx.fillText('Synthetic research figure', 30, 175);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const data = new DataTransfer(); data.items.add(new File([blob], 'figure.png', { type: 'image/png' }));
    document.querySelector('[contenteditable="true"]').dispatchEvent(drop ? new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }) : new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, drop);
}
async function moveMedia(page, source, label, targetIndex = 12, sourceId = null) {
  const snapshot = () => page.locator('.bn-editor [data-content-type]').evaluateAll(nodes => nodes.map(node => ({ id: node.closest('[data-id]')?.getAttribute('data-id'), type: node.getAttribute('data-content-type') })));
  const before = await snapshot();
  const id = sourceId || await source.evaluate(node => node.closest('[data-id]')?.getAttribute('data-id'));
  const target = page.locator('.bn-editor [data-content-type="paragraph"]').nth(targetIndex);
  if (!sourceId) { await source.scrollIntoViewIfNeeded(); await target.scrollIntoViewIfNeeded(); }
  await page.waitForTimeout(550); // Each move is a separate Undo operation.
  if (sourceId) {
    // dragTo scrolls its target first, which retargets a floating hover handle.
    // Drive the actual mouse from the already-visible handle instead.
    const start = await source.boundingBox(), end = await target.boundingBox();
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2); await page.mouse.down();
    await page.mouse.move(start.x + start.width / 2 + 6, start.y + start.height / 2, { steps: 3 });
    await page.mouse.move(end.x + 80, end.y + 3, { steps: 10 }); await page.mouse.up();
  } else await source.dragTo(target, { sourcePosition: { x: 10, y: 10 }, targetPosition: { x: 80, y: 3 } });
  await page.waitForTimeout(300);
  const after = await snapshot();
  assert.deepEqual(after.map(node => node.id).sort(), before.map(node => node.id).sort(), `${label} moves the original blocks, without a copied block or plain URL`);
  assert.notEqual(after.findIndex(node => node.id === id), before.findIndex(node => node.id === id), `${label} actually changes position`);
  await target.click(); await page.keyboard.press('Control+z'); await page.waitForTimeout(200);
  assert.deepEqual(await snapshot(), before, `${label} Undo restores the original order without duplicates`);
  await page.keyboard.press('Control+Shift+z'); await page.waitForTimeout(200);
  assert.deepEqual(await snapshot(), after, `${label} Redo restores the moved order`);
}
async function moveMediaHandle(page, source, label, targetIndex) {
  const id = await source.evaluate(node => node.closest('[data-id]')?.getAttribute('data-id'));
  await source.scrollIntoViewIfNeeded(); await source.hover({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(100);
  const handle = page.locator('[data-test="dragHandle"]').locator('xpath=ancestor::button[1]');
  await handle.waitFor();
  await moveMedia(page, handle, label, targetIndex, id);
}
try {
  for (const lang of ['vi', 'en']) for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 980 } }); page = await context.newPage();
    await context.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
    await context.route('https://fonts.gstatic.com/**', route => route.abort());
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && message.text().includes('occurred in the')) errors.push(message.text()); });
    await context.route('**/api/**', async route => {
      const image = /\/images\/([a-f0-9]{32})$/.exec(new URL(route.request().url()).pathname);
      if (image && route.request().method() === 'GET') {
        const value = await page.evaluate(id => { const file = window.projectMediaImages?.get(id); return file ? { mime: file.mime, bytes: [...new Uint8Array(file.bytes)] } : null; }, image[1]);
        return value ? route.fulfill({ contentType: value.mime, body: Buffer.from(value.bytes) }) : route.fulfill({ status: 404 });
      }
      return route.abort();
    });
    page.on('request', request => { if (!new URL(request.url()).hostname.match(/^(127\.0\.0\.1|localhost|fonts\.googleapis\.com|fonts\.gstatic\.com)$/)) external.push(request.url()); });
    await page.goto(`${base}/tests/fixtures/projects.html?media=1&lang=${lang}&theme=${theme}#/collab/page/${root}`);
    const editor = page.locator('[contenteditable="true"]').first(); await editor.waitFor();
    assert.equal(await page.locator('.field-topbar-actions .social-toolbar, .project-social .social-toolbar').count(), 0);
    await pasteImage(page);
    await page.locator('.notebook-media-image').first().scrollIntoViewIfNeeded();
    await page.locator('.notebook-media-image img').waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.notebook-media-image img')].every(image => image.complete && image.naturalWidth > 0));
    assert.equal(await page.evaluate(() => window.projectQA.imageUploads), 1);
    const caption = page.getByRole('textbox', { name: lang === 'vi' ? 'Chú thích ảnh' : 'Image caption', exact: true }).first();
    await caption.fill('A pasted research figure'); await caption.press('Tab');
    await page.getByRole('button', { name: /A pasted research figure/ }).click();
    await page.getByRole('dialog', { name: lang === 'vi' ? 'Xem ảnh notebook' : 'Notebook image preview', exact: true }).waitFor();
    await page.getByRole('button', { name: lang === 'vi' ? 'Đóng ảnh' : 'Close image', exact: true }).press('Escape');
    await page.locator('.bn-editor [data-content-type="paragraph"]').nth(13).click();
    await page.evaluate(() => { const data = new DataTransfer(); data.setData('text/plain', 'https://example.invalid/guide'); document.querySelector('[contenteditable="true"]').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); });
    await page.locator('.notebook-url-card[href="https://example.invalid/guide"]').waitFor();
    await page.getByRole('button', { name: lang === 'vi' ? 'Liên kết URL' : 'URL link', exact: true }).first().click();
    const modal = page.getByRole('dialog', { name: lang === 'vi' ? 'Thêm ảnh hoặc liên kết' : 'Add image or link', exact: true });
    await modal.waitFor();
    const url = modal.getByRole('textbox', { name: lang === 'vi' ? 'URL liên kết' : 'Link URL', exact: true });
    await url.fill('javascript:alert(1)'); assert(await modal.getByRole('button', { name: lang === 'vi' ? 'Chèn liên kết' : 'Insert link', exact: true }).isDisabled());
    await url.fill('https://example.invalid/paper'); await modal.getByRole('textbox', { name: lang === 'vi' ? 'Tên hiển thị (không bắt buộc)' : 'Display title (optional)', exact: true }).fill('A source link');
    await modal.getByRole('button', { name: lang === 'vi' ? 'Chèn liên kết' : 'Insert link', exact: true }).click();
    await page.locator('.notebook-url-card').filter({ hasText: 'A source link' }).waitFor();
    await moveMedia(page, page.locator('.notebook-media-image img').first(), 'Dragging an image body');
    await moveMedia(page, page.locator('.notebook-url-card').filter({ hasText: 'A source link' }), 'Dragging a URL card');
    const figure = page.locator('.notebook-media-image').first(), size = figure.getByRole('combobox', { name: lang === 'vi' ? 'Kích thước ảnh' : 'Image size', exact: true }), resize = figure.getByRole('slider');
    await figure.hover(); await size.selectOption('50');
    assert.equal(await figure.evaluate(node => node.style.width), '50%');
    await resize.focus(); await resize.press('ArrowLeft');
    assert.equal(await size.inputValue(), '49');
    await resize.scrollIntoViewIfNeeded(); await figure.hover();
    const grip = await resize.boundingBox();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down(); await page.mouse.move(grip.x - 45, grip.y + grip.height / 2, { steps: 8 }); await page.mouse.up();
    const savedWidth = Number(await size.inputValue());
    assert(savedWidth >= 25 && savedWidth < 49, 'Pointer handle shrinks the image without creating a block');
    const aspect = await figure.locator('img').evaluate(image => { const box = image.getBoundingClientRect(); return Math.abs(box.width / box.height - image.naturalWidth / image.naturalHeight); });
    assert(aspect < .02, 'Resize preserves the image aspect ratio');
    assert.equal(await page.locator('.notebook-media-image').count(), 1);
    assert.equal(await page.evaluate(() => window.projectQA.imageUploads), 1, 'Moving/resizing does not upload another image');
    await moveMediaHandle(page, figure.locator('img'), 'Image six-dot handle', 10);
    await moveMediaHandle(page, page.locator('.notebook-url-card').filter({ hasText: 'A source link' }), 'URL six-dot handle', 9);
    assert.equal(await size.inputValue(), String(savedWidth), 'Moving keeps image sizing');
    await page.getByRole('button', { name: lang === 'vi' ? 'Ảnh' : 'Image', exact: true }).first().click();
    await modal.getByRole('textbox', { name: lang === 'vi' ? 'Hoặc nhập URL ảnh công khai' : 'Or enter a public image URL', exact: true }).fill('https://example.invalid/public.png');
    await modal.getByRole('button', { name: lang === 'vi' ? 'Nhập ảnh' : 'Import image', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.notebook-media-image').length === 2);
    await pasteImage(page, true);
    await page.waitForFunction(() => document.querySelectorAll('.notebook-media-image').length === 3);
    await page.waitForTimeout(350);
    await page.reload(); await editor.waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.notebook-media-image').length === 3);
    assert.equal(await caption.inputValue(), 'A pasted research figure');
    assert.equal(await size.inputValue(), String(savedWidth), 'Saved image width survives a full reload');
    assert.equal(await page.locator('.notebook-url-card').count(), 2);
    await page.waitForFunction(() => [...document.querySelectorAll('.notebook-media-image img')].every(image => image.complete && image.naturalWidth > 0));
    await page.locator('.notebook-media-image').first().scrollIntoViewIfNeeded();
    await page.locator('.notebook-media-image').first().hover({ position: { x: 10, y: 10 } });
    await page.screenshot({ path: path.join(folder, `${theme}-${lang}-desktop.png`), fullPage: true });
    // Bad image files fail visibly without adding a broken block or replacing text.
    await page.evaluate(() => { window.projectQA.failImageUpload = true; });
    await pasteImage(page);
    await page.getByRole('alert').filter({ hasText: lang === 'vi' ? 'Chọn ảnh PNG' : 'Choose a valid static PNG' }).waitFor();
    assert.equal(await page.locator('.notebook-media-image').count(), 3);
    await page.evaluate(() => { window.projectQA.failImageUpload = false; });
    await page.setViewportSize({ width: 360, height: 820 });
    await page.getByRole('button', { name: lang === 'vi' ? 'Ảnh' : 'Image', exact: true }).first().click(); await modal.waitFor();
    const box = await modal.boundingBox(); assert(box.x >= 0 && box.x + box.width <= 360);
    await page.screenshot({ path: path.join(folder, `${theme}-${lang}-mobile-dialog.png`) });
    await modal.getByRole('button', { name: lang === 'vi' ? 'Đóng' : 'Close', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 980 });
    await page.evaluate(() => { window.projectQA.holdImageUpload = true; });
    await pasteImage(page);
    await page.evaluate(id => { location.hash = '#/collab/page/' + id; }, other);
    await page.waitForURL('**#/collab/page/' + other); await editor.waitFor(); await page.waitForTimeout(900);
    assert.equal(await page.locator('.notebook-media-image').count(), 0, 'Pending image cannot land in the next page');
    await page.goto(`${base}/tests/fixtures/projects.html?mode=viewer&media=1&lang=${lang}&theme=${theme}#/collab/page/${root}`);
    await page.locator('.notebook-media-image').first().waitFor();
    assert.equal(await page.locator('.notebook-media-tools').count(), 0);
    assert.equal(await page.getByRole('textbox', { name: lang === 'vi' ? 'Chú thích ảnh' : 'Image caption', exact: true }).count(), 0, 'Viewer reads captions but cannot edit them');
    assert.equal(await page.getByRole('slider').count(), 0, 'Viewer cannot resize images');
    assert.equal(await page.getByRole('combobox', { name: lang === 'vi' ? 'Kích thước ảnh' : 'Image size', exact: true }).count(), 0);
    assert.equal(await figure.evaluate(node => node.style.width), `${savedWidth}%`, 'Viewer sees the saved width');
    assert.equal(await figure.getAttribute('draggable'), 'false', 'Viewer cannot move an image');
    assert.equal(await page.locator('.notebook-url-block').first().getAttribute('draggable'), 'false', 'Viewer cannot move a URL card');
    assert.equal(await page.locator('.notebook-media-image figcaption').filter({ hasText: 'A pasted research figure' }).count(), 1);
    await context.close();
  }
  const context = await browser.newContext(), viewer = await context.newPage();
  await viewer.goto(`${base}/tests/fixtures/projects.html?mode=viewer&media=1#/collab/page/${root}`); await viewer.locator('.bn-editor').waitFor();
  assert.equal(await viewer.locator('.notebook-media-tools').count(), 0, 'Viewer has no upload/insert controls'); await context.close();
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('Notebook media passed: actual paste/drop, image/URL body and six-dot moves without duplication, ID preservation, Undo/Redo, dropdown/keyboard/pointer resizing, aspect ratio, saved width, image URL import, URL cards, captions, preview, reload durability, failed-upload safety, unsafe URLs, page-switch cancellation, viewer restrictions, light/dark, VI/EN and mobile. APIs/live transport mocked; no external requests.');
} catch (error) { if (page && !page.isClosed()) { await page.screenshot({ path: path.join(folder, 'failure.png'), fullPage: true }); console.error((await page.locator('body').innerText()).slice(-1800)); } throw error; }
finally { await browser.close(); }
