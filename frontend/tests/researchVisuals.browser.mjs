/* Real components, synthetic report, intercepted documents. No paid calls. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = process.env.NEXORA_PLAYWRIGHT_DIR ? require(path.join(process.env.NEXORA_PLAYWRIGHT_DIR, 'playwright')) : await import('playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.NEXORA_BROWSER_EXECUTABLE ? { executablePath: process.env.NEXORA_BROWSER_EXECUTABLE } : {}) });
const base = process.env.NEXORA_TEST_URL || 'http://127.0.0.1:5174';
const errors = [], dialogs = [];
const screenshots = path.resolve('../tmp/research-visuals-qa');
let fixturePayload;
await mkdir(screenshots, { recursive: true });
try {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    let documentRequests = 0, failPreview = false;
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
    await page.route('**/api/**', async route => {
      const url = route.request().url(); documentRequests++;
      assert.match(url, /\/api\/research\/documents\/a{64}\/pages\/\d+\/(image|locate)$/);
      if (failPreview) return route.fulfill({ status: 404, json: { detail: 'Document not found.' } });
      if (url.endsWith('/image')) return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXZkAAAAASUVORK5CYII=', 'base64') });
      return route.fulfill({ json: { matched: !url.includes('/pages/2/'), page_count: 2, rectangles: url.includes('/pages/2/') ? [] : [{ x: .1, y: .1, width: .5, height: .04 }] } });
    });
    await page.goto(`${base}/tests/research-preview.html?theme=${theme}`);
    await page.locator('.research-reader').waitFor();
    fixturePayload = await page.evaluate(() => window.__researchVisualFixture);
    await page.getByRole('button', { name: 'Khám phá trực quan', exact: true }).click();
    const flow = page.locator('.research-visual[data-kind="flow"]');
    await flow.getByRole('button', { name: 'Bước tiếp theo', exact: true }).click();
    assert.equal(await flow.getByRole('button', { name: 'Suy luận: tạo dự đoán', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.match(await flow.locator('.research-visual__detail').innerText(), /sử dụng model đã học/);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(screenshots, `${theme}-desktop.png`) });
    const trigger = flow.locator('.research-visual__detail > .research-visual__source');
    await trigger.click();
    const drawer = page.getByRole('dialog');
    await drawer.waitFor({ state: 'visible' });
    assert.match(await drawer.innerText(), /The method has a training stage/);
    await page.keyboard.press('Escape');
    assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
    const bar = page.locator('.research-visual[data-kind="bar"]');
    await bar.getByRole('combobox').selectOption('descending');
    assert.match(await bar.locator('.research-visual__bars > button').first().innerText(), /Alpha/);
    await bar.locator('.research-visual__bars > button').first().click();
    assert.match(await bar.getByRole('region', { name: 'Chi tiết dòng dữ liệu' }).innerText(), /67.73/);
    await bar.getByRole('button', { name: 'Bảng số liệu', exact: true }).click();
    assert.equal(await bar.locator('tbody tr').count(), 2);
    const formula = page.locator('.research-visual[data-kind="equation"]');
    await formula.getByRole('button', { name: 'B', exact: true }).click();
    assert.match(await formula.getByRole('region', { name: 'Giải thích ký hiệu' }).innerText(), /Tập B/);
    assert.equal(documentRequests, 0, 'Cached exploration must not fetch anything');
    await page.screenshot({ path: path.join(screenshots, `${theme}-explorer.png`), fullPage: true });
    await page.getByRole('button', { name: 'Giải thích cơ chế / phương pháp', exact: true }).click();
    assert.equal(await page.locator('.research-reader__section').filter({ has: page.getByRole('heading', { name: 'Giải thích cơ chế / phương pháp', exact: true }) }).evaluate(element => element === document.activeElement), true);
    await page.getByRole('button', { name: 'Paper gốc', exact: true }).click();
    await page.getByRole('button', { name: 'Xem trang PDF & hình gốc ngay tại đây', exact: true }).click();
    await page.locator('.research-original__page img').waitFor();
    await page.getByText('Vùng được đánh dấu là vị trí', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Trang PDF tiếp theo', exact: true }).click();
    await page.getByText('Không xác định được vị trí trích đoạn', { exact: false }).waitFor();
    await page.getByRole('combobox').selectOption('200');
    assert.equal(await page.locator('.research-original__page').evaluate(element => element.style.width), '200%');
    await page.getByRole('button', { name: 'Đóng trang PDF', exact: true }).click();
    failPreview = true;
    await page.getByRole('button', { name: 'Xem trang PDF & hình gốc ngay tại đây', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Không mở được trang PDF' }).waitFor();
    failPreview = false;
    await page.getByRole('button', { name: 'Đóng trang PDF', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Khám phá trực quan', exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'No page-wide mobile overflow');
    await page.screenshot({ path: path.join(screenshots, `${theme}-mobile.png`), fullPage: true });
    await context.close();
  }
  const page = await browser.newPage();
  await page.goto(`${base}/tests/research-preview.html?legacy=1`);
  await page.getByRole('button', { name: 'Khám phá trực quan', exact: true }).click();
  await page.locator('.research-visual__detail > .research-visual__source').click();
  await page.getByText('Report này chỉ lưu nguồn chung của hình', { exact: false }).waitFor();
  await page.keyboard.press('Escape');
  await page.goto(`${base}/tests/research-preview.html?lang=en`);
  await page.getByRole('button', { name: 'Visual explorer', exact: true }).click();
  await page.getByRole('button', { name: 'Next step', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Data table', exact: true }).count(), 1);
  await page.goto(`${base}/tests/research-preview.html?outcome=failed`);
  await page.getByRole('alert').filter({ hasText: 'Phân tích chưa thành công' }).waitFor();
  for (const [state, title] of [['legacy-invalid', 'Hình bị lỗi định dạng'], ['invalid_structure', 'Hình bị lỗi định dạng'], ['source_rejected', 'Hình chưa khớp nguồn'], ['audit_rejected', 'Hình không qua đối chiếu ngữ nghĩa'], ['audit_unavailable', 'Chưa kiểm chứng được hình'], ['budget_exhausted', 'Chưa đủ ngân sách để hoàn tất hình'], ['insufficient_evidence', 'Chưa tạo hình từ các đoạn đã đọc'], ['not_generated', 'Chưa tạo được hình']]) {
    await page.goto(`${base}/tests/research-preview.html?visual_state=${state}&theme=dark`);
    await page.getByRole('button', { name: 'Khám phá trực quan', exact: true }).click();
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    assert.equal(await page.locator('.research-visual').count(), 0);
    assert.match(await page.locator('.research-visual-status').innerText(), /Report đã lưu không tự chạy lại/);
  }
  await page.screenshot({ path: path.join(screenshots, 'empty-visual-status.png') });
  // Open a saved schema-3.1 report through the actual Library, not just a fixture.
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => { localStorage.setItem('deep-research-language', 'vi'); localStorage.setItem('deep-research-appearance', 'dark'); });
  const appPage = await context.newPage();
  appPage.on('pageerror', error => errors.push(error.message));
  const record = { id: 'qa-visual.md', title: 'QA saved visual report', created_at: '2026-10-12T10:00:00Z', size_bytes: 5000, source_count: 1, research_depth: 'deep', language: 'vi', sources: [], final_report: 'QA stored report', report_data: fixturePayload };
  // Register before navigation so interception is installed in this document.
  let starts = 0;
  await appPage.routeWebSocket(/\/ws\/research(?:\?.*)?$/, socket => socket.onMessage(message => {
    const request = JSON.parse(message.toString());
    if (request.event === 'start_research') {
      starts++;
      socket.send(JSON.stringify({ event: 'report_complete', outcome: 'partial', final_report: record.final_report, report_data: fixturePayload, filepath: record.id, source_count: 1 }));
    }
  }));
  await appPage.route('**/health', route => route.fulfill({ json: { status: 'ok' } }));
  await appPage.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/research/chats/config') return route.fulfill({ json: { nexora: { ready: true }, opencode: { ready: false, configured: false, code: 'opencode_not_configured', models: [] } } });
    if (url.pathname === '/api/research/chats') return route.fulfill({ json: { conversations: [] } });
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { authenticated: true, user: { id: 'google:qa-report', name: 'QA Researcher', public_name: 'QA Researcher', email: 'qa@example.invalid', username: 'qa-research', provider: 'google', role: 'member', status: 'active', license_type: 'free', login_count: 2 }, session: { remembered: true, choice_pending: false, expires_at: '2026-11-12T00:00:00Z' } } });
    if (url.pathname === '/api/reports') return route.fulfill({ json: { reports: [record] } });
    if (url.pathname === '/api/reports/qa-visual.md') return route.fulfill({ json: record });
    if (url.pathname === '/api/auth/onboarding') return route.fulfill({ json: { tours: [{ tour_id: 'core', version: 1, step_index: 8, status: 'completed' }] } });
    if (url.pathname === '/api/notifications/count') return route.fulfill({ json: { unread_count: 0 } });
    return route.fulfill({ json: {} });
  });
  await appPage.goto(`${base}/#/library`);
  await appPage.getByRole('button', { name: 'Mở báo cáo', exact: true }).click();
  await appPage.locator('.report-list').getByRole('button').filter({ hasText: record.title }).click();
  await appPage.locator('.research-reader').waitFor();
  await appPage.getByRole('button', { name: 'Khám phá trực quan', exact: true }).click();
  await appPage.getByRole('button', { name: 'Bước tiếp theo', exact: true }).click();
  assert.equal(await appPage.locator('.research-visual').count(), 4);
  await appPage.evaluate(() => scrollTo(0, 0));
  await appPage.screenshot({ path: path.join(screenshots, 'saved-report-library.png') });
  await appPage.setViewportSize({ width: 390, height: 844 });
  assert.equal(await appPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  // Exercise completion and returning to the input form through the actual App.
  // Intercept the socket entirely: this must never launch a paid research run.
  await appPage.setViewportSize({ width: 1440, height: 1000 });
  await appPage.getByRole('button', { name: 'Nghiên cứu', exact: true }).click();
  await appPage.locator('.research-chat-screen:not([hidden]) .research-chat').waitFor();
  await appPage.getByRole('button', { name: 'Báo cáo · công cụ hiện tại', exact: true }).click();
  await appPage.locator('#topic').fill('Kiểm thử báo cáo trực quan, không gọi model thật.');
  await appPage.locator('.primary-actions button').first().click();
  try { await appPage.locator('.workspace--reader .research-reader').waitFor(); }
  catch (error) {
    await appPage.screenshot({ path: path.join(screenshots, 'completion-failure.png') });
    console.log({ starts, errors, body: (await appPage.locator('body').innerText()).slice(-3500) });
    throw error;
  }
  assert.equal(starts, 1);
  assert.equal(await appPage.locator('#topic').isVisible(), false);
  assert.ok((await appPage.locator('.research-reader').boundingBox()).width > 1100, 'Completed report must use the full workspace, not the old half-width form column.');
  await appPage.getByRole('button', { name: 'Khám phá trực quan', exact: true }).click();
  await appPage.getByRole('button', { name: 'Bước tiếp theo', exact: true }).click();
  await appPage.evaluate(() => scrollTo(0, 0));
  await appPage.screenshot({ path: path.join(screenshots, 'completed-research.png') });
  await appPage.setViewportSize({ width: 390, height: 844 });
  assert.equal(await appPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await appPage.locator('.stage-header button').click();
  assert.equal(await appPage.locator('#topic').isVisible(), true);
  assert.equal(await appPage.locator('#topic').inputValue(), '');
  // Optional: inspect a previously generated real provider artifact, with NO
  // provider calls here and only a fake account/library response in the browser.
  if (process.env.NEXORA_VISUAL_QA_REPORT) {
    const live = JSON.parse(await readFile(process.env.NEXORA_VISUAL_QA_REPORT, 'utf8'));
    assert.equal(live.qa_only, true);
    assert.equal(live.visual_status.status, 'ready');
    assert.ok(live.visuals.length > 0 && live.visuals.every(visual => visual.verification === 'model_checked'));
    record.report_data = live;
    record.title = 'QA MediaPipe: hình được tạo bởi model thực tế';
    await appPage.setViewportSize({ width: 1440, height: 1000 });
    await appPage.goto(`${base}/#/library`);
    await appPage.reload();
    await appPage.getByRole('button', { name: 'Mở báo cáo', exact: true }).click();
    await appPage.locator('.report-list').getByRole('button').filter({ hasText: record.title }).click();
    await appPage.getByRole('button', { name: 'Khám phá trực quan', exact: true }).click();
    assert.equal(await appPage.locator('.research-visual').count(), live.visuals.length);
    const flow = appPage.locator('.research-visual[data-kind="flow"]');
    await flow.getByRole('button', { name: 'Bước tiếp theo', exact: true }).click();
    await flow.locator('.research-visual__detail > .research-visual__source').click();
    await appPage.getByRole('dialog', { name: 'Dẫn chứng cho nhận xét' }).waitFor();
    await appPage.keyboard.press('Escape');
    await appPage.evaluate(() => scrollTo(0, 0));
    await appPage.screenshot({ path: path.join(screenshots, 'mediapipe-model-visuals.png'), fullPage: true });
    await flow.screenshot({ path: path.join(screenshots, 'mediapipe-model-flow.png') });
    await appPage.setViewportSize({ width: 390, height: 844 });
    assert.equal(await appPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    const mobileTable = appPage.locator('.research-visual[data-kind="table"] .research-evidence__table');
    assert.equal(await mobileTable.evaluate(element => element.scrollWidth > element.clientWidth), true, 'A wide table scrolls locally, not letter by letter');
    assert.ok(await mobileTable.locator('th').first().evaluate(element => element.getBoundingClientRect().width) >= 100);
    await appPage.screenshot({ path: path.join(screenshots, 'mediapipe-model-mobile.png'), fullPage: true });
  }
  await context.close();
  assert.deepEqual(errors, []); assert.deepEqual(dialogs, []);
  console.log('Research browser QA passed: stepper, graph, per-component sources, focus, tables, equations, original pages, errors, legacy, EN/VI, light/dark, mobile, saved Library, full-width completion, new topic, no AI calls.');
} finally { await browser.close(); }
