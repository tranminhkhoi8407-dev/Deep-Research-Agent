/* Real component and App shell. Every API request is mocked; no inference. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = process.env.NEXORA_PLAYWRIGHT_DIR ? require(path.join(process.env.NEXORA_PLAYWRIGHT_DIR, 'playwright')) : await import('playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.NEXORA_BROWSER_EXECUTABLE ? { executablePath: process.env.NEXORA_BROWSER_EXECUTABLE } : {}) });
const base = process.env.NEXORA_TEST_URL || 'http://127.0.0.1:5173';
const folder = path.resolve('../tmp/research-visuals-qa/chat');
await mkdir(folder, { recursive: true });
const errors = [], dialogs = [];
let activePage;
const fixtureImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO1cAAAAASUVORK5CYII=', 'base64');
try {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
    await context.addInitScript(theme => { localStorage.setItem('deep-research-language', 'vi'); localStorage.setItem('deep-research-appearance', theme); }, theme);
    const page = await context.newPage();
    activePage = page;
    let reportSocket, reportRequests = 0, reportSocketClosed = false;
    await page.routeWebSocket('**/ws/research', socket => {
      reportSocket = socket;
      socket.onMessage(() => { reportRequests++; });
      socket.onClose(() => { reportSocketClosed = true; });
    });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && (message.text().includes('occurred in the') || message.text().includes('Uncaught'))) errors.push(message.text()); });
    page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
    const store = new Map(), attachments = new Map();
    let creates = 0, sends = 0, uploads = 0, failOnce = false, holdJob = false, detailReads = 0;
    const config = { nexora: { ready: true, image_inputs: true }, opencode: { configured: true, ready: true, code: 'ready', models: [
      { id: 'nexora-configured', name: 'Nexora · gemini · fixture-model', policy: 'configured_provider', private_allowed: true, image_inputs: true, ready: true },
      { id: 'longcat-2.5-preview-free', name: 'LongCat 2.5 Preview Free', policy: 'preview_zero_retention', private_allowed: false, image_inputs: false, ready: true },
      { id: 'muse-spark-1.3-contributor-free', name: 'Muse Spark 1.3 Free', policy: 'training_data', private_allowed: false, ready: false, code: 'opencode_service_access_required' }
    ] } };
    await context.route('**/health', route => route.fulfill({ json: { status: 'ok' } }));
    await context.route('**/api/**', async route => {
      const req = route.request(), url = new URL(req.url()), data = req.headers()['content-type']?.includes('application/json') ? req.postDataJSON() : null;
      const fulfill = (body, status = 200) => route.fulfill({ status, json: body });
      if (url.pathname === '/api/auth/providers') return fulfill({ providers: { google: true }, dev_login: false });
      if (url.pathname === '/api/auth/me') return fulfill({ authenticated: true, user: { id: 'browser-fixture', provider: 'google', name: 'QA Researcher', public_name: 'QA Researcher', email: 'qa@example.invalid', avatar_url: null, username: null, role: 'member', status: 'active', license_type: 'free', license_expires_at: null }, session: { remembered: true, choice_pending: false, expires_at: new Date(Date.now() + 86400000).toISOString(), persistent_days: 30, session_hours: 12 } });
      if (!url.pathname.startsWith('/api/research/chats')) {
        if (url.pathname.includes('notifications/unread')) return fulfill({ count: 0 });
        if (url.pathname.includes('tour')) return fulfill({ completed: true, dismissed: true, preferences: {} });
        return fulfill({ reports: [], papers: [], items: [], projects: [], sources: [], settings: {} });
      }
      const suffix = url.pathname.replace('/api/research/chats', '');
      if (suffix === '/config') return fulfill(config);
      if (suffix === '/activity') return fulfill({ activities: [...store.values()].flatMap(item => item.jobs.map(job => ({ ...job, conversation_id: item.id, title: item.title, engine: item.engine }))) });
      if (suffix === '/search') return fulfill({ conversations: [...store.values()].filter(item => item.title.includes(url.searchParams.get('q') || '')) });
      if (suffix === '/attachments' && req.method() === 'POST') {
        uploads++; const name = decodeURIComponent(req.headers()['x-attachment-name']);
        const item = { id: uploads.toString(16).padStart(32, '0'), name, mime: name.endsWith('.png') ? 'image/png' : 'application/octet-stream', kind: name.endsWith('.png') ? 'image' : 'document', size: req.postDataBuffer()?.length || 1, warning: '' };
        attachments.set(item.id, item); return fulfill(item, 201);
      }
      if (suffix.startsWith('/attachments/')) {
        const aid = suffix.split('/')[2];
        if (req.method() === 'DELETE') { attachments.delete(aid); return route.fulfill({ status: 204 }); }
        return route.fulfill({ contentType: 'image/png', body: fixtureImage });
      }
      if (suffix === '' && req.method() === 'GET') return fulfill({ conversations: [...store.values()].filter(item => item.archived === (url.searchParams.get('archived') === 'true')) });
      if (suffix === '' && req.method() === 'POST') {
        creates++; const convo = { id: 'chat-' + creates, title: 'Cuộc trò chuyện mới', ...data, model_label: data.model === 'nexora-configured' ? 'Nexora · gemini · fixture-model' : '', pinned: false, archived: false, updated_at: Date.now()/1000, messages: [], jobs: [] };
        store.set(convo.id, convo); return fulfill(convo, 201);
      }
      const [cid, action] = suffix.slice(1).split('/');
      const convo = store.get(cid);
      if (!convo) return fulfill({ detail: 'not_found' }, 404);
      if (action === 'messages') {
        const previous = convo.jobs.find(job => job.client_id === data.client_id);
        if (previous) return fulfill(previous, 202);
        sends++; detailReads = 0;
        assert.equal(data.action, 'chat', 'New UI must never create a report');
        const job = { id: 'job-' + sends, ...data, status: 'running', stage: 'replying', usage: {} };
        convo.jobs.unshift(job); convo.title = data.text || 'Attached files';
        convo.messages.push({ id: 'm-' + sends, role: 'user', body: data.text || 'Attached files', job_id: job.id, attachments: data.attachment_ids.map(id => attachments.get(id)) });
        if (failOnce) { failOnce = false; return route.abort('failed'); }
        return fulfill(job, 202);
      }
      if (action === 'stop') { convo.jobs[0].status = 'cancelled'; convo.jobs[0].error_code = 'cancelled'; return fulfill({ status: 'stop_requested' }); }
      if (req.method() === 'PATCH') { Object.assign(convo, data); return fulfill(convo); }
      detailReads++; const job = convo.jobs[0];
      if (job && job.status === 'running' && detailReads > 1 && !holdJob) { job.status = 'completed'; convo.messages.push({ id: 'reply-' + job.id, role: 'assistant', body: 'Phản hồi mô phỏng, không gọi model.', job_id: job.id }); }
      return fulfill(convo);
    });
    await page.goto(base + '/tests/research-chat-preview.html?theme=' + theme);
    console.log('Checking', theme, 'chat and attachments');
    const input = page.getByRole('textbox', { name: 'Tin nhắn nghiên cứu', exact: true });
    await input.waitFor();
    assert.deepEqual(await page.getByRole('combobox', { name: 'Chế độ chat', exact: true }).locator('option').allTextContents(), ['Chat', 'Research Together']);
    assert.equal(await page.getByText('Cấu hình báo cáo').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Tạo báo cáo', exact: true }).count(), 0);
    await page.waitForFunction(() => document.querySelector('.research-chat__sidebar').getBoundingClientRect().width >= 200);
    const originalWidth = await page.locator('.research-chat__sidebar').evaluate(el => el.getBoundingClientRect().width);
    await page.getByRole('button', { name: 'Thu thanh bên', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.research-chat').classList.contains('is-collapsed'));
    await page.waitForFunction(initial => document.querySelector('.research-chat__sidebar').getBoundingClientRect().width < initial, originalWidth);
    assert((await page.locator('.research-chat__sidebar').evaluate(el => el.getBoundingClientRect().width)) < originalWidth);
    await page.getByRole('button', { name: 'Mở lịch sử', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.research-chat').classList.contains('is-collapsed'));
    await page.getByRole('button', { name: 'Đổi độ rộng thanh bên', exact: true }).press('ArrowRight');
    await page.waitForFunction(initial => document.querySelector('.research-chat__sidebar').getBoundingClientRect().width > initial, originalWidth);
    assert((await page.locator('.research-chat__sidebar').evaluate(el => el.getBoundingClientRect().width)) > originalWidth);
    await input.fill('Giải thích MediaPipe bằng tiếng Việt');
    await page.getByRole('button', { name: 'Gửi', exact: true }).click();
    await page.getByText('Phản hồi mô phỏng, không gọi model.', { exact: true }).waitFor();
    assert.equal(creates, 1); assert.equal(sends, 1);
    await page.reload(); await page.getByText('Phản hồi mô phỏng, không gọi model.', { exact: true }).waitFor(); assert.equal(sends, 1);
    assert.equal(await page.locator('.research-chat__header small').innerText(), 'Chat');
    assert.equal(await page.locator('.research-chat__header button[aria-label="Tùy chọn hội thoại"]').count(), 0);
    await page.getByRole('button', { name: 'Tùy chọn: Giải thích MediaPipe bằng tiếng Việt', exact: true }).click();
    await page.getByRole('button', { name: 'Đổi tên cuộc trò chuyện', exact: true }).click();
    await page.getByRole('textbox', { name: 'Tên cuộc trò chuyện', exact: true }).fill('MediaPipe · nghiên cứu');
    await page.getByRole('button', { name: 'Lưu', exact: true }).click();
    await page.getByRole('button', { name: 'Tùy chọn: MediaPipe · nghiên cứu', exact: true }).click();
    await page.getByRole('button', { name: 'Ghim cuộc trò chuyện', exact: true }).click();
    await page.getByRole('region', { name: 'Đã ghim', exact: true }).getByRole('button', { name: 'MediaPipe · nghiên cứu', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Hội thoại đã lưu trữ', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Cuộc trò chuyện mới', exact: true }).click();
    await page.locator('input[type=file]').setInputFiles([{ name: 'draft.png', mimeType: 'image/png', buffer: fixtureImage }, { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic document context.') }]);
    assert.equal(uploads, 0, 'Choosing files must not upload before send');
    assert.equal(await page.locator('.research-chat__attachments .research-chat__file').count(), 2);
    await page.getByRole('button', { name: 'Xem ảnh draft.png' }).click();
    await page.getByRole('dialog', { name: 'Xem ảnh đính kèm' }).waitFor();
    await page.getByRole('button', { name: 'Đóng ảnh' }).press('Escape');
    await page.getByRole('dialog', { name: 'Xem ảnh đính kèm' }).waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Gỡ notes.txt' }).click();
    await input.fill('Giải thích hình này');
    await page.screenshot({ path: path.join(folder, theme + '-attachments-desktop.png') });
    await page.getByRole('button', { name: 'Gửi', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.research-chat__composer textarea').disabled);
    assert.equal(uploads, 1);
    assert.equal(await page.locator('.research-chat__sent-files .research-chat__file').count(), 1);
    await page.reload();
    await page.locator('.research-chat__sent-files .research-chat__file').waitFor();
    assert.equal(sends, 2);
    await page.getByRole('button', { name: 'Xem ảnh draft.png' }).click();
    await page.getByRole('button', { name: 'Đóng ảnh' }).click();
    failOnce = true;
    await input.fill('Lượt gửi bị mất phản hồi');
    await page.getByRole('button', { name: 'Gửi', exact: true }).click();
    await page.getByRole('button', { name: 'Kiểm tra lại lượt gửi này' }).click();
    await page.waitForFunction(() => !document.querySelector('.research-chat__composer textarea').disabled);
    assert.equal(sends, 3, 'Retry uses the same accepted request ID');
    holdJob = true; await input.fill('Lượt cần dừng');
    await page.getByRole('button', { name: 'Gửi', exact: true }).click();
    await page.getByRole('button', { name: 'Dừng', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Đã dừng lượt chạy.' }).waitFor(); holdJob = false;
    await page.getByRole('button', { name: 'Cuộc trò chuyện mới', exact: true }).click();
    await page.getByRole('combobox', { name: 'Chế độ chat', exact: true }).selectOption('opencode');
    const modelSelect = page.getByRole('combobox', { name: 'Model OpenCode', exact: true });
    assert.equal(await modelSelect.count(), 0, 'Muse is fixed: no model selector');
    await input.fill('Public default-model connectivity fixture');
    await page.getByRole('checkbox').check();
    assert(await page.getByRole('button', { name: 'Gửi', exact: true }).isDisabled(), 'Unavailable Muse blocks send rather than substituting another provider');
    const createsBeforeRefresh = creates;
    await page.getByRole('button', { name: 'Kiểm tra lại kết nối', exact: true }).click();
    assert.equal(await modelSelect.count(), 0);
    assert.equal(creates, createsBeforeRefresh, 'Connection checks never create a session or call a model');
    await input.fill('');
    await page.locator('input[type=file]').setInputFiles({ name: 'private.txt', mimeType: 'text/plain', buffer: Buffer.from('Private fixture') });
    await page.getByRole('button', { name: 'Kiểm tra lại kết nối', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Không gửi PDF tải lên' }).waitFor();
    assert(await page.getByRole('button', { name: 'Gửi', exact: true }).isDisabled());
    assert.equal(uploads, 1, 'Data policy blocks uploads as well as inference');
    await page.getByRole('button', { name: 'Gỡ private.txt' }).click();
    // Seed a historical configured-provider conversation; new UI cannot select it.
    const historical = { id: 'historical-native', engine: 'opencode', model: 'nexora-configured', model_label: 'Nexora · gemini · fixture-model', title: 'Historical native conversation', pinned: false, archived: false, updated_at: Date.now()/1000, messages: [], jobs: [] };
    store.set(historical.id, historical);
    await page.evaluate(id => localStorage.setItem('nexora-research-chat:browser-fixture', id), historical.id);
    await page.reload(); await input.waitFor();
    await page.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['Synthetic drag only'], 'drop.txt', { type: 'text/plain' })); document.querySelector('.research-chat__composer').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); });
    await page.getByRole('button', { name: 'Gửi', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.research-chat__composer textarea').disabled);
    assert.equal(sends, 5); assert.equal(uploads, 2, 'File-only messages work in the configured OpenCode model');
    const savedOpenCode = [...store.values()].find(item => item.engine === 'opencode');
    assert.equal(savedOpenCode.model, 'nexora-configured', 'Historical model is retained');
    await page.reload();
    await page.locator('.research-chat__header small').filter({hasText:'Research Together'}).waitFor();
    assert.equal(await page.locator('.research-chat__model-info').count(),0);
    assert.equal(await modelSelect.count(), 0, 'Existing sessions retain their model without an editable new-chat selector');
    await page.getByRole('button', { name: 'Cuộc trò chuyện mới', exact: true }).click();
    await page.getByRole('combobox', { name: 'Chế độ chat', exact: true }).selectOption('opencode');
    assert.equal(await modelSelect.count(), 0, 'New conversation has no model selection');
    assert.equal(savedOpenCode.model, 'nexora-configured', 'Starting fresh never rewrites an existing conversation');
    for (const width of [736, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForFunction(() => { const c = document.querySelector('.research-chat__composer').getBoundingClientRect(); return c.bottom <= innerHeight && c.top >= 0; });
      if (width < 701) {
        await page.getByRole('button', { name: 'Mở lịch sử', exact: true }).click();
        const side = page.getByRole('dialog', { name: 'Lịch sử nghiên cứu', exact: true }); await side.waitFor();
        assert.equal(await page.locator('.research-chat__main').evaluate(el => el.hasAttribute('inert')), true);
        await page.getByRole('button', { name: 'Đóng lịch sử', exact: true }).click();
        assert.equal(await page.locator('.research-chat__main').evaluate(el => el.hasAttribute('inert')), false);
      }
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow at ' + width);
      assert(await page.evaluate(() => { const c = document.querySelector('.research-chat__composer').getBoundingClientRect(); return c.bottom <= innerHeight && c.top >= 0; }), 'Composer stays inside screen at ' + width);
    }
    await page.screenshot({ path: path.join(folder, theme + '-mobile.png') });
    await page.getByRole('button', { name: 'Mở lịch sử', exact: true }).click();
    await page.getByRole('button', { name: 'Báo cáo · công cụ hiện tại' }).click();
    assert.equal(await page.title(), 'Classic requested');
    // Reports is a child of Research. Both hide global chrome and keep chat
    // drafts in memory. All navigation is local and never starts inference.
    console.log('Checking', theme, 'full App shell');
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(base + '/#/research');
    await page.locator('.app-shell--research .research-chat').waitFor();
    assert.equal(await page.locator('.topbar').count(), 0);
    assert.equal(await page.locator('.site-footer').count(), 0);
    assert.equal(await page.locator('.research-chat__sidebar .social-toolbar, .research-chat__social').count(), 0, 'Research does not render the friends/notification cluster');
    assert.equal(await page.locator('.research-chat__header button[aria-label="Tùy chọn hội thoại"]').count(), 0, 'Conversation menus belong only to sidebar rows');
    await page.screenshot({ path: path.join(folder, theme + '-app-fullscreen.png') });
    const appInput = page.getByRole('textbox', { name: 'Tin nhắn nghiên cứu', exact: true });
    await appInput.fill('Bản nháp giữ nguyên khi mở Reports');
    await page.locator('input[type=file]').setInputFiles({ name: 'unsent-context.txt', mimeType: 'text/plain', buffer: Buffer.from('Unsent local context.') });
    const sendsBeforeNavigation = sends, uploadsBeforeNavigation = uploads;
    await page.getByRole('button', { name: 'Báo cáo · công cụ hiện tại' }).click();
    await page.locator('.research-reports .workspace').waitFor();
    assert.equal(new URL(page.url()).hash, '#/research/reports');
    assert.equal(await page.locator('.topbar').count(), 0);
    assert.equal(await page.locator('.site-footer').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Chat Nexora / Chat OpenCode', exact: true }).count(), 0);
    assert.equal(await page.locator('.research-chat-screen').isHidden(), true);
    await page.screenshot({ path: path.join(folder, theme + '-reports-desktop.png') });
    await page.getByRole('button', { name: 'Quay lại trò chuyện', exact: true }).click();
    await appInput.waitFor();
    assert.equal(await appInput.inputValue(), 'Bản nháp giữ nguyên khi mở Reports');
    assert.equal(await page.locator('.research-chat__attachments .research-chat__file').count(), 1);
    assert.equal(sends, sendsBeforeNavigation); assert.equal(uploads, uploadsBeforeNavigation);
    await page.goBack(); await page.locator('.research-reports').waitFor();
    await page.goBack(); await appInput.waitFor();
    await page.goForward(); await page.locator('.research-reports').waitFor();
    await page.reload(); await page.locator('.research-reports').waitFor();
    assert.equal(await page.locator('.topbar').count(), 0);
    for (const width of [1024, 736, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Report shell has no outer overflow at ' + width);
      assert(await page.locator('.research-reports__content').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Report content has no horizontal overflow at ' + width);
      const back = await page.getByRole('button', { name: 'Quay lại trò chuyện', exact: true }).boundingBox();
      assert(back.y >= 0 && back.y + back.height < 100, 'Report back stays visible at ' + width);
    }
    await page.screenshot({ path: path.join(folder, theme + '-reports-mobile.png') });
    await page.getByRole('button', { name: 'Quay lại trò chuyện', exact: true }).click();
    await appInput.waitFor();
    await page.getByRole('button', { name: 'Về Nexora', exact: true }).click();
    await page.locator('.topbar').waitFor();
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.getByRole('button', { name: 'Nghiên cứu', exact: true }).click();
    await appInput.waitFor();
    assert.equal(new URL(page.url()).hash, '#/research');
    assert.equal(await page.locator('.research-reports').count(), 0);
    await page.getByRole('button', { name: 'Báo cáo · công cụ hiện tại' }).click();
    await page.getByRole('button', { name: 'Về Nexora', exact: true }).click();
    await page.locator('.topbar').waitFor();
    await page.getByRole('button', { name: 'Nghiên cứu', exact: true }).click();
    await appInput.waitFor();
    assert.equal(await page.locator('.research-reports').count(), 0, 'Research does not remember reports as its landing page');
    // A running classic report continues while its child view is hidden. The
    // report and figures below are synthetic; the real research socket is mocked.
    const fixturePage = await context.newPage();
    await fixturePage.goto(base + '/tests/research-preview.html');
    await fixturePage.locator('.research-reader').waitFor();
    const reportFixture = await fixturePage.evaluate(() => window.__researchVisualFixture);
    await fixturePage.close();
    await page.getByRole('button', { name: 'Báo cáo · công cụ hiện tại' }).click();
    await page.locator('#topic').fill('Đề bài kiểm thử giao diện, không gọi model thật.');
    await page.getByRole('button', { name: 'Bắt đầu nghiên cứu', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Đang nghiên cứu' }).waitFor();
    await page.waitForFunction(() => document.querySelector('.research-reports__running') !== null);
    assert.equal(reportRequests, 1);
    await page.getByRole('button', { name: 'Quay lại trò chuyện', exact: true }).click();
    await appInput.waitFor();
    assert.equal(reportSocketClosed, false, 'Back to chat must not abort research');
    await page.getByText('Phiên nghiên cứu đang chạy', { exact: true }).waitFor();
    reportSocket.send(JSON.stringify({ event: 'report_complete', final_report: '# Synthetic report\nNo actual inference.', report_data: reportFixture, filepath: 'offline-fixture.md', source_count: 1, outcome: 'partial' }));
    await page.getByText('Phiên nghiên cứu đang chạy', { exact: true }).waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Báo cáo · công cụ hiện tại' }).click();
    await page.locator('.research-reports .workspace--reader .research-reader').waitFor();
    assert.equal(await page.locator('.topbar').count(), 0);
    assert.equal(await page.locator('.site-footer').count(), 0);
    assert.equal(reportRequests, 1, 'Opening completed report never regenerates it');
    await page.screenshot({ path: path.join(folder, theme + '-reports-reader.png') });
    await page.setViewportSize({ width: 320, height: 844 });
    const readerBack = await page.getByRole('button', { name: 'Quay lại trò chuyện', exact: true }).boundingBox();
    assert(readerBack.y >= 0 && readerBack.y + readerBack.height < 100);
    await page.getByRole('button', { name: 'Quay lại trò chuyện', exact: true }).click();
    await appInput.waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Về Nexora', exact: true }).click();
    await page.locator('.topbar').waitFor();
    await page.getByRole('button', { name: 'ENG', exact: true }).click();
    await page.getByRole('button', { name: 'Research', exact: true }).click();
    await page.getByRole('textbox', { name: 'Research message', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Open history', exact: true }).click();
    await page.getByRole('button', { name: 'Reports · classic workspace', exact: true }).click();
    await page.getByRole('button', { name: 'Back to chat', exact: true }).waitFor();
    assert.equal(await page.locator('.topbar').count(), 0);
    await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
    await page.getByRole('button', { name: 'Back to Nexora', exact: true }).click();
    await page.locator('.topbar').waitFor();
    await context.close();
  }
  // Default selection is deterministic for ready, offline and removed models.
  // Use isolated browser state and public synthetic prompts; no real inference.
  for (const state of ['ready', 'worker-offline', 'muse-not-allowed', 'direct-ready']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
    await context.addInitScript(() => { localStorage.setItem('deep-research-language', 'vi'); });
    const page = await context.newPage(); activePage = page;
    page.on('pageerror', error => errors.push(error.message));
    let conversation, creates = 0, sends = 0, directEnabled = state === 'direct-ready';
    const models = [{ id: 'nexora-configured', name: 'Nexora · gemini · fixture-model', policy: 'configured_provider', private_allowed: true, ready: true }];
    if (state !== 'muse-not-allowed') models.push({ id: 'muse-spark-1.3-contributor-free', name: 'Muse Spark 1.3 Free', policy: 'training_data', private_allowed: false, ready: true });
    if (state === 'direct-ready') Object.assign(models[1], { transport: 'direct_hil_v1', gateway_ready: false, gateway_code: 'opencode_unreachable' });
    await context.route('**/api/research/chats**', async route => {
      const req = route.request(), url = new URL(req.url()), suffix = url.pathname.replace('/api/research/chats', '');
      const data = req.method() === 'POST' ? req.postDataJSON() : null;
      if (suffix === '/config') return route.fulfill({ json: { opencode: { configured: true, ready: state !== 'worker-offline', code: state === 'worker-offline' ? 'opencode_unreachable' : 'ready', direct_enabled: directEnabled, gateway_ready: !['worker-offline', 'direct-ready'].includes(state), gateway_code: 'opencode_unreachable', models } } });
      if (suffix === '' && req.method() === 'GET') return route.fulfill({ json: { conversations: conversation ? [conversation] : [] } });
      if (suffix === '' && req.method() === 'POST') {
        creates++; assert.equal(data.model, 'muse-spark-1.3-contributor-free');
        conversation = { ...data, id: 'muse-default-fixture', title: 'Public Muse fixture', model_label: 'Muse Spark 1.3 Free', runtime_transport: state === 'direct-ready' ? 'direct_hil_v1' : 'gateway', pinned: false, archived: false, updated_at: Date.now()/1000, messages: [], jobs: [] };
        return route.fulfill({ status: 201, json: conversation });
      }
      if (suffix.endsWith('/messages')) {
        sends++; const job = { id: 'mimo-job', status: 'completed', stage: 'replying', action: 'chat', usage: {} };
        conversation.messages.push({ id: 'mimo-reply', role: 'assistant', body: 'MiMo default fixture completed', job_id: job.id }); conversation.jobs = [job];
        return route.fulfill({ status: 202, json: job });
      }
      return route.fulfill({ json: conversation || {} });
    });
    await page.goto(base + '/tests/research-chat-preview.html');
    await page.getByRole('combobox', { name: 'Chế độ chat', exact: true }).selectOption('opencode');
    const selector = page.getByRole('combobox', { name: 'Model OpenCode', exact: true });
    await page.locator('.research-chat__consent-note').waitFor();
    assert.equal(await page.locator('.research-chat__model-info').count(),0);
    assert.equal(await selector.count(), 0);
    await page.getByRole('textbox', { name: 'Tin nhắn nghiên cứu', exact: true }).fill('Public fixture only');
    await page.getByRole('checkbox').check();
    const send = page.getByRole('button', { name: 'Gửi', exact: true });
    if (['ready', 'direct-ready'].includes(state)) {
      await send.click(); await page.getByText('MiMo default fixture completed', { exact: true }).waitFor();
      assert.equal(creates, 1); assert.equal(sends, 1); assert.equal(conversation.model, 'muse-spark-1.3-contributor-free');
      if (state === 'direct-ready') {
        assert.equal(conversation.runtime_transport, 'direct_hil_v1');
        for (const width of [390, 320]) {
          await page.setViewportSize({ width, height: 844 });
          await page.waitForFunction(() => { const c=document.querySelector('.research-chat__composer').getBoundingClientRect(); return c.bottom<=innerHeight && c.top>=0; });
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        }
        await page.screenshot({ path: path.join(folder, 'mimo-direct-active-mobile.png') });
        conversation.runtime_transport = 'gateway';
        await page.reload();
        await page.getByRole('status').filter({ hasText: 'Không kết nối được worker' }).waitFor();
        assert(await page.getByRole('button', { name: 'Gửi', exact: true }).isDisabled(), 'An old gateway session never silently uses the new direct transport');
        await page.getByText('Phiên này giữ đường kết nối cũ. Tạo cuộc trò chuyện mới để thử OpenCode trực tiếp.', { exact: true }).waitFor();
        conversation.runtime_transport='direct_hil_v1'; directEnabled=false;
        await page.reload();
        await page.getByRole('status').filter({ hasText: 'Đường OpenCode trực tiếp đang tắt' }).waitFor();
        assert(await page.getByRole('button', { name: 'Gửi', exact: true }).isDisabled(), 'Disabling direct never silently switches the saved session');
      }
    } else {
      assert(await send.isDisabled());
      await page.getByRole('status').filter({ hasText: state === 'worker-offline' ? 'Không kết nối được worker' : 'chưa được bật trên server' }).waitFor();
      await page.getByRole('button', { name: 'Kiểm tra lại kết nối', exact: true }).click();
      assert.equal(creates, 0); assert.equal(sends, 0);
    }
    await page.screenshot({ path: path.join(folder, 'mimo-' + state + '.png') });
    await context.close();
  }
  assert.deepEqual(errors, []); assert.deepEqual(dialogs, []);
  console.log('Research browser checks passed: fixed Muse (ready, unavailable, offline, missing), no model selector, historical models retained, chat/reports full screen, VI/EN, light/dark, 320–1440px, exit/back, browser history/reload, draft/files preserved, background report completion/reader, no navigation replay, attachments, consent, retry and stop. HTTP and research WebSockets mocked; no model calls.');
} catch (error) {
  if (activePage && !activePage.isClosed()) { await activePage.screenshot({ path: path.join(folder, 'failure.png'), fullPage: true }); console.error((await activePage.locator('body').innerText()).slice(-2200)); console.error(await activePage.evaluate(() => { const host = document.querySelector('.research-reports__content'); if (!host) return []; const box = host.getBoundingClientRect(); return Array.from(host.querySelectorAll('*')).filter(el => { const rect = el.getBoundingClientRect(); return rect.width > 0 && rect.right > box.right + 1; }).map(el => ({ className: el.className, tag: el.tagName, right: el.getBoundingClientRect().right, width: el.getBoundingClientRect().width })).slice(0, 20); })); }
  throw error;
} finally { await browser.close(); }
