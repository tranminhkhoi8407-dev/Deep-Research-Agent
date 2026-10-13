import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chatModeLabel, runningChat, latestReport, errorLabel, policyLabel, validateChatFiles, sidebarWidth, isImageFile, isPdfFile, publicPdfSupported, defaultOpenCodeModel, DEFAULT_OPENCODE_MODEL } from '../src/researchChatModel.ts';
import { CompletionTracker } from '../src/researchActivityModel.ts';

test('friendly mode labels preserve engine IDs and use the approved English names', () => {
  assert.equal(chatModeLabel('nexora'), 'Chat');
  assert.equal(chatModeLabel('opencode'), 'Research Together');
  assert.match(errorLabel('opencode_pdf_only', false), /Use Chat mode/);
});

test('completion tracking is session-independent, silent on reload and never treats human waiting or failure as success', () => {
  const tracker = new CompletionTracker();
  const jobs = (...pairs) => pairs.map(([id, status]) => ({ id, status }));
  assert.deepEqual(tracker.observe(jobs(['old', 'completed'])), []);
  assert.deepEqual(tracker.observe(jobs(['a', 'running'], ['b', 'queued'])), []);
  assert.deepEqual(tracker.observe(jobs(['a', 'awaiting_input'], ['b', 'completed'])), ['b']);
  assert.deepEqual(tracker.observe(jobs(['a', 'running'], ['b', 'completed'])), []);
  assert.deepEqual(tracker.observe(jobs(['a', 'completed'])), ['a']);
  assert.deepEqual(tracker.observe(jobs(['a', 'completed'])), []);
  for (const status of ['failed', 'cancelled', 'interrupted', 'partial']) {
    tracker.observe(jobs([status, 'running']));
    assert.deepEqual(tracker.observe(jobs([status, status])), []);
  }
  assert.deepEqual(new CompletionTracker().observe(jobs(['a', 'completed'])), []);
});

test('new OpenCode chats default to Muse regardless of list order', () => {
  assert.equal(DEFAULT_OPENCODE_MODEL, 'muse-spark-1.3-contributor-free');
  for (const models of [
    [{ id: 'nexora-configured', ready: true }, { id: DEFAULT_OPENCODE_MODEL, ready: true }],
    [{ id: DEFAULT_OPENCODE_MODEL, ready: true }, { id: 'longcat-2.5-preview-free', ready: true }],
  ]) assert.equal(defaultOpenCodeModel(models), DEFAULT_OPENCODE_MODEL);
});

test('unavailable Muse never silently falls back to a ready provider', () => {
  const models = Object.freeze([Object.freeze({ id: 'nexora-configured', ready: true }), Object.freeze({ id: DEFAULT_OPENCODE_MODEL, ready: false })]);
  assert.equal(defaultOpenCodeModel(models), DEFAULT_OPENCODE_MODEL);
});

test('missing Muse disables new OpenCode chat instead of substituting another model', () => {
  assert.equal(defaultOpenCodeModel([{ id: 'longcat-2.5-preview-free', ready: true }]), '');
  assert.equal(defaultOpenCodeModel([]), '');
  assert.match(errorLabel('opencode_model_not_allowed', true), /không tự chuyển/);
  assert.match(errorLabel('opencode_model_not_allowed', false), /no automatic switch/);
});

test('human wait also blocks another turn in the same conversation', () => {
  for (const status of ['queued', 'running', 'awaiting_input']) assert.equal(runningChat({ status }), true);
  for (const status of ['completed', 'failed', 'cancelled', 'interrupted']) assert.equal(runningChat({ status }), false);
});
test('report versions are explicit, not chat prose', () => {
  assert.equal(latestReport([{ id: 'b', action: 'chat' }, { id: 'a', report_id: 'v1.md' }]), 'v1.md');
  assert.equal(latestReport([]), undefined);
});
test('safe bilingual errors explain no model fallback and no replay', () => {
  assert.match(errorLabel('opencode_capacity', true), /không tự chuyển/);
  assert.match(errorLabel('worker_interrupted', false), /not replayed/);
  assert.match(errorLabel('opencode_service_access_required', true), /quyền API/);
  assert.match(errorLabel('opencode_free_tier_restricted', true), /Key hợp lệ chưa bảo đảm/);
  assert.match(errorLabel('opencode_free_tier_restricted', false), /no automatic retry/);
  assert.match(errorLabel('opencode_configured_model_changed', false), /never switch silently/);
  assert.match(errorLabel('arbitrary-secret-provider-text', true), /Chưa hoàn tất/);
});
test('contributor and private-data policy are never hidden', () => {
  assert.match(policyLabel('training_data', true), /huấn luyện/);
  assert.match(policyLabel('configured_provider', true), /không gửi sang Console/);
  assert.match(policyLabel('trial_no_confidential', false), /confidential/);
});

test('chat file limits reject unsupported formats and do not guess model support', () => {
  assert.equal(validateChatFiles([{ name: 'notes.md', size: 100 }, { name: 'IMAGE.PNG', size: 100 }]), '');
  assert.equal(validateChatFiles([{ name: 'active.svg', size: 100 }]), 'attachment_unsupported_type');
  assert.equal(validateChatFiles([{ name: 'empty.txt', size: 0 }]), 'attachment_empty');
  assert.equal(validateChatFiles([{ name: 'huge.txt', size: 11 * 1024 * 1024 }]), 'attachment_too_large');
  assert.equal(validateChatFiles(Array.from({ length: 6 }, () => ({ name: 'file.txt', size: 1 }))), 'attachment_count_limit');
  assert.equal(validateChatFiles(Array.from({ length: 4 }, () => ({ name: 'file.jpg', size: 1 }))), 'attachment_count_limit');
  assert.equal(isImageFile({ name: 'schema.PNG' }), true);
  assert.equal(isImageFile({ name: 'schema.svg' }), false);
  assert.match(errorLabel('attachment_image_not_supported', true), /không tự đổi/);
});

test('sidebar resize remains bounded and tolerates corrupt preferences', () => {
  assert.equal(sidebarWidth(20), 200); assert.equal(sidebarWidth(500), 360);
  assert.equal(sidebarWidth(Number.NaN), 280); assert.equal(sidebarWidth(245), 245);
});

test('public PDF capability is specific to Muse interactive, not general private access',()=>{
  const model={id:DEFAULT_OPENCODE_MODEL,pdf_attachments:true,private_allowed:false};
  assert(publicPdfSupported(model,'direct_hil_v1'));
  assert(!publicPdfSupported(model,'gateway'));
  assert(!publicPdfSupported(model,'direct_v1'));
  assert(!publicPdfSupported({...model,id:'mimo-v2.6-flash-free'},'direct_hil_v1'));
  assert(!publicPdfSupported({...model,pdf_attachments:false},'direct_hil_v1'));
  assert(isPdfFile({name:'PUBLIC.PDF'}));assert(!isPdfFile({name:'public.pdf.exe'}));
});
