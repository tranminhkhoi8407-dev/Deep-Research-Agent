/* Isolated UI verification. All API calls mocked; no personal chats or models. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(process.env.NEXORA_PLAYWRIGHT_DIR, 'playwright'));
const browser = await chromium.launch({ headless: true, executablePath: process.env.NEXORA_BROWSER_EXECUTABLE });
const base = process.env.NEXORA_TEST_URL || 'http://127.0.0.1:5173';
const folder = path.resolve('../tmp/research-visuals-qa/activity');
await mkdir(folder, { recursive: true });
const errors = [];
let page;
try {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    await context.addInitScript(() => {
      localStorage.setItem('nexora-research-chat:browser-fixture', 'alpha');
      window.chimeNotes = 0;
      window.AudioContext = class {
        state = 'running'; currentTime = 0; destination = {};
        resume() { this.state = 'running'; return Promise.resolve(); }
        close() { this.state = 'closed'; return Promise.resolve(); }
        createOscillator() { return { frequency: { value: 0 }, connect() {}, disconnect() {}, start() { window.chimeNotes++; }, stop() {} }; }
        createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
      };
    });
    const job = (id, status) => ({ id, status, stage: status === 'awaiting_input' ? status : 'replying', action: 'chat', usage: {}, created_at: Date.now()/1000, updated_at: Date.now()/1000 });
    const chat = (id, title, pinned, status) => ({ id, title, pinned, archived: false, engine: 'opencode', model: 'muse-spark-1.3-contributor-free', runtime_transport: 'direct_hil_v1', settings: {}, updated_at: Date.now()/1000, messages: [{ id: 'm-' + id, role: 'assistant', body: id === 'alpha' ? 'hidden needle is inside the message' : 'Synthetic fixture', attachments: [] }], jobs: [job('job-' + id, status)] });
    const store = new Map([['alpha', chat('alpha', 'Alpha notebook', true, 'completed')], ['beta', chat('beta', 'Beta research', false, 'running')], ['human', chat('human', 'Scope question', false, 'awaiting_input')], ['old', { ...chat('old', 'Archived legacy', false, 'completed'), archived: true }]]);
    let deletes = 0, mutations = 0;
    const config = { nexora: { ready: true }, opencode: { ready: true, configured: true, direct_enabled: true, code: 'ready', models: [{ id: 'muse-spark-1.3-contributor-free', name: 'Muse Spark 1.3 Free', ready: true, transport: 'direct_hil_v1', pdf_attachments: true, private_allowed: false }] } };
    await context.route('**/api/**', async route => {
      const req = route.request(), url = new URL(req.url()), suffix = url.pathname.replace('/api/research/chats', '');
      const fulfill = (body, status=200) => route.fulfill({ status, json: body });
      if (!url.pathname.startsWith('/api/research/chats')) return fulfill({});
      if (suffix === '/config') return fulfill(config);
      if (suffix === '/activity') return fulfill({ activities: [...store.values()].filter(c => !c.archived).flatMap(c => c.jobs.map(j => ({ ...j, conversation_id: c.id, title: c.title, engine: c.engine }))) });
      if (suffix === '/search') {
        const q = url.searchParams.get('q').toLowerCase();
        if (q === 'slow') await new Promise(resolve => setTimeout(resolve, 450));
        return fulfill({ conversations: [...store.values()].filter(c => !c.archived && (c.title.toLowerCase().includes(q) || c.messages.some(m => m.body.includes(q)))).map(c => ({ ...c, snippet: c.messages[0]?.body })) });
      }
      if (suffix === '') return fulfill({ conversations: [...store.values()].filter(c => !c.archived).map(c => ({ ...c, latest_job: c.jobs[0] })) });
      const c = store.get(suffix.slice(1));
      if (!c) return fulfill({ detail: 'not_found' }, 404);
      if (req.method() === 'DELETE') { assert(!['running', 'queued', 'awaiting_input'].includes(c.jobs[0]?.status)); deletes++; store.delete(c.id); return route.fulfill({ status: 204 }); }
      if (req.method() === 'PATCH') { mutations++; Object.assign(c, req.postDataJSON()); }
      return fulfill(c);
    });
    page = await context.newPage(); page.on('pageerror', err => errors.push(err.message));
    page.on('console', message => { if (message.type() === 'error' && (message.text().includes('occurred in the') || message.text().includes('Uncaught'))) errors.push(message.text()); });
    await page.goto(base + '/tests/research-chat-preview.html?theme=' + theme);
    const input = page.getByRole('textbox', { name: 'Tin nhắn nghiên cứu', exact: true });
    await input.waitFor(); await page.getByRole('button', { name: 'Alpha notebook', exact: true }).waitFor();
    assert.equal(await page.locator('.research-chat__header button[aria-label="Tùy chọn hội thoại"]').count(), 0);
    assert.equal(await page.locator('.research-chat__social, .research-chat__sidebar .social-toolbar').count(), 0);
    const pinned = page.getByRole('region', { name: 'Đã ghim', exact: true });
    await pinned.getByRole('button', { name: 'Alpha notebook', exact: true }).waitFor();
    assert.equal(await pinned.getByRole('button', { name: 'Alpha notebook', exact: true }).locator('small').innerText(), 'Research Together');
    assert.equal(await page.locator('.research-chat__header small').innerText(), 'Research Together');
    assert.equal(await page.getByText('Archived', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Archived legacy', exact: true }).count(), 0);
    await page.locator('.research-chat__history-row').filter({ hasText: 'Beta research' }).getByLabel('Đang xử lý', { exact: true }).waitFor();
    await page.locator('.research-chat__history-row').filter({ hasText: 'Scope question' }).getByLabel('Chờ bạn trả lời', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.chimeNotes), 0, 'Initial completed history is silent');
    await input.fill('Keep this unsent draft');
    const betaMenu = page.getByRole('button', { name: 'Tùy chọn: Beta research', exact: true });
    await betaMenu.click();
    assert(await page.getByRole('button', { name: 'Lưu trữ và xóa', exact: true }).isDisabled());
    await page.getByRole('button', { name: 'Đổi tên cuộc trò chuyện', exact: true }).press('Escape');
    assert(await betaMenu.evaluate(el => el === document.activeElement), 'Escape restores row menu focus');
    await betaMenu.click(); await page.getByRole('button', { name: 'Đổi tên cuộc trò chuyện', exact: true }).click();
    await page.getByRole('textbox', { name: 'Tên cuộc trò chuyện', exact: true }).fill('Beta renamed');
    await page.getByRole('button', { name: 'Lưu', exact: true }).click();
    await page.getByRole('button', { name: 'Beta renamed', exact: true }).waitFor();
    assert.equal(await input.inputValue(), 'Keep this unsent draft', 'Renaming another session preserves the selected draft');
    await page.getByRole('button', { name: 'Tùy chọn: Beta renamed', exact: true }).click(); await page.getByRole('button', { name: 'Ghim cuộc trò chuyện', exact: true }).click();
    await pinned.getByRole('button', { name: 'Beta renamed', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Tùy chọn: Beta renamed', exact: true }).click();
    await page.screenshot({ path: path.join(folder, theme + '-sidebar-menu.png') });
    await page.getByRole('button', { name: 'Bỏ ghim cuộc trò chuyện', exact: true }).click();
    await page.getByRole('region', { name: 'Cuộc trò chuyện gần đây', exact: true }).getByRole('button', { name: 'Beta renamed', exact: true }).waitFor();
    await page.keyboard.press('Control+Alt+u'); await page.getByRole('dialog', { name: 'Hoạt động', exact: true }).waitFor();
    await page.screenshot({ path: path.join(folder, theme + '-activity.png') });
    assert(await page.getByRole('button', { name: 'Âm báo khi hoàn tất', exact: true }).getAttribute('aria-pressed') === 'true');
    await page.getByRole('button', { name: 'Đóng', exact: true }).click();
    store.get('beta').jobs[0].status = 'completed';
    await page.waitForFunction(() => window.chimeNotes === 2);
    await page.waitForTimeout(2200);
    assert.equal(await page.evaluate(() => window.chimeNotes), 2, 'Background completion rings once');
    assert.equal(await input.inputValue(), 'Keep this unsent draft');
    // Same origin second tab: the durable delivery record prevents refresh replay.
    const second = await context.newPage(); await second.goto(base + '/tests/research-chat-preview.html?theme=' + theme);
    await second.getByRole('button', { name: 'Xem hoạt động', exact: true }).click();
    assert.equal(await second.evaluate(() => window.chimeNotes), 0);
    await second.getByRole('button', { name: 'Đóng', exact: true }).click();
    store.get('human').jobs[0].status = 'running';
    await page.waitForTimeout(2300);
    store.get('human').jobs[0].status = 'completed';
    await page.waitForFunction(() => localStorage.getItem('nexora-chat-completed:browser-fixture')?.includes('job-human'));
    assert.equal((await page.evaluate(() => window.chimeNotes)) + (await second.evaluate(() => window.chimeNotes)), 4, 'Two tabs together play only one completion chime');
    await second.close();
    await page.keyboard.press('Control+k'); await page.getByRole('dialog', { name: 'Tìm cuộc trò chuyện', exact: true }).waitFor();
    const keywords = page.getByRole('textbox', { name: 'Từ khóa tìm kiếm', exact: true });
    await keywords.fill('slow'); await page.waitForTimeout(250); await keywords.fill('needle');
    await page.getByRole('dialog').getByRole('button', { name: /Alpha notebook/ }).waitFor();
    await page.waitForTimeout(500); assert.equal(await page.getByRole('dialog').getByRole('button', { name: /Alpha notebook/ }).count(), 1);
    await page.screenshot({ path: path.join(folder, theme + '-search.png') });
    await keywords.press('Escape'); assert.equal(await input.inputValue(), 'Keep this unsent draft');
    await page.getByRole('button', { name: 'Tùy chọn: Beta renamed', exact: true }).click(); await page.getByRole('button', { name: 'Lưu trữ và xóa', exact: true }).click();
    await page.getByRole('button', { name: 'Hủy', exact: true }).click(); assert.equal(deletes, 0);
    await page.getByRole('button', { name: 'Tùy chọn: Beta renamed', exact: true }).click(); await page.getByRole('button', { name: 'Lưu trữ và xóa', exact: true }).click();
    await page.getByRole('button', { name: 'Xóa vĩnh viễn', exact: true }).click();
    await page.getByRole('button', { name: 'Beta renamed', exact: true }).waitFor({ state: 'detached' }); assert.equal(deletes, 1);
    assert.equal(await input.inputValue(), 'Keep this unsent draft');
    await page.getByRole('button', { name: 'Xem hoạt động', exact: true }).click();
    await page.getByRole('button', { name: 'Âm báo khi hoàn tất', exact: true }).click();
    await page.getByRole('button', { name: 'Đóng', exact: true }).click();
    const mutedNotes = await page.evaluate(() => window.chimeNotes);
    store.get('alpha').jobs.unshift(job('muted-job', 'running')); await page.waitForTimeout(2300);
    store.get('alpha').jobs[0].status = 'completed'; await page.waitForTimeout(2300);
    assert.equal(await page.evaluate(() => window.chimeNotes), mutedNotes, 'Muted completions remain silent');
    await page.reload(); await input.waitFor(); assert.equal(await page.evaluate(() => window.chimeNotes), 0, 'Reload never replays completion');
    await page.getByRole('button', { name: 'Xem hoạt động', exact: true }).click(); assert.equal(await page.getByRole('button', { name: 'Âm báo khi hoàn tất', exact: true }).getAttribute('aria-pressed'), 'false'); await page.getByRole('button', { name: 'Đóng', exact: true }).click();
    // Deterministically emulate cancellation while decoding a response body.
    // A completed selected run disposes its poll; this must never set list to
    // undefined and unmount the whole workspace.
    await page.evaluate(() => {
      const original = window.fetch; let selectedSignal;
      window.abortBodyChecks = 0;
      window.fetch = async (url, options) => {
        const pathname = new URL(url, location.href).pathname;
        if (pathname === '/api/research/chats/alpha' && options?.signal) selectedSignal = options.signal;
        if (pathname === '/api/research/chats' && selectedSignal && options?.signal === selectedSignal) {
          window.abortBodyChecks++;
          return { ok: true, status: 200, json: () => new Promise((resolve, reject) => {
            const abort = () => reject(new DOMException('Synthetic cancelled body', 'AbortError'));
            if (selectedSignal.aborted) return abort();
            selectedSignal.addEventListener('abort', abort, { once: true });
            setTimeout(() => resolve({}), 800);
          }) };
        }
        return original(url, options);
      };
    });
    store.get('alpha').jobs.unshift(job('abort-body-job', 'running'));
    await page.getByRole('button', { name: 'Alpha notebook', exact: true }).click();
    await page.getByRole('button', { name: 'Dừng', exact: true }).waitFor();
    store.get('alpha').jobs[0].status = 'completed';
    await page.waitForFunction(() => window.abortBodyChecks > 0);
    await page.waitForTimeout(1000);
    assert.equal(await page.locator('.research-chat').count(), 1, 'Aborted response decoding cannot blank the app');
    await page.getByRole('button', { name: 'Alpha notebook', exact: true }).waitFor();
    await page.setViewportSize({ width: 320, height: 700 }); await page.getByRole('button', { name: 'Mở lịch sử', exact: true }).click();
    await page.getByRole('button', { name: 'Tùy chọn: Alpha notebook', exact: true }).click();
    await page.screenshot({ path: path.join(folder, theme + '-mobile-menu.png') });
    const menuBox = await page.locator('.research-chat__row-menu').boundingBox(); assert(menuBox.x >= 0 && menuBox.x + menuBox.width <= 320);
    await page.getByRole('button', { name: 'Đổi tên cuộc trò chuyện', exact: true }).press('Escape');
    await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click();
    await keywords.fill('needle'); await page.getByRole('dialog').getByRole('button', { name: /Alpha notebook/ }).waitFor();
    await page.screenshot({ path: path.join(folder, theme + '-mobile-search.png') });
    const searchBox = await page.locator('.research-chat__tools-dialog[open]').boundingBox(); assert(searchBox.x >= 0 && searchBox.x + searchBox.width <= 320);
    await page.getByRole('dialog').getByRole('button', { name: /Alpha notebook/ }).click();
    await page.getByRole('textbox', { name: 'Tin nhắn nghiên cứu', exact: true }).waitFor();
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.getByRole('button', { name: 'Tùy chọn: Alpha notebook', exact: true }).click(); await page.getByRole('button', { name: 'Lưu trữ và xóa', exact: true }).click(); await page.getByRole('button', { name: 'Xóa vĩnh viễn', exact: true }).click();
    await page.getByRole('heading', { name: 'Bạn muốn tìm hiểu điều gì?', exact: true }).waitFor(); assert.equal(deletes, 2); assert.equal(mutations, 3);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Activity UI passed: Pinned, row menus, rename draft safety, permanent-delete confirmation, per-session spinner/HIL, search shortcuts/content/stale responses, background chime, mute persistence, two-tab dedup, reload silence, light/dark, 320px dialogs. All APIs mocked.');
} catch (error) {
  if (page && !page.isClosed()) { await page.screenshot({ path: path.join(folder, 'failure.png') }); console.error((await page.locator('body').innerText()).slice(-1700)); }
  throw error;
} finally { await browser.close(); }
