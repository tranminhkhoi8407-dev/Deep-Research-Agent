import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
async function moduleFrom(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}
const { sidebarWidth, sidebarLimit, restoreSidebar } = await moduleFrom('../src/workspaceSidebar.ts');
const { NotebookApiError, notebookError, notebookApi } = await moduleFrom('../src/notebookApi.ts');
test('sidebar preference restoration rejects invalid widths and collapsed flags', () => {
  assert.deepEqual(restoreSidebar(null), { width: 270, collapsed: false });
  assert.deepEqual(restoreSidebar({ width: NaN, collapsed: 'true' }), { width: 270, collapsed: false });
  assert.deepEqual(restoreSidebar({ width: 900, collapsed: true }), { width: 600, collapsed: true });
  assert.equal(restoreSidebar({ width: -50 }).width, 220);
});
test('sidebar respects both resize boundaries and leaves room for the editor', () => {
  assert.equal(sidebarWidth(420, 1440), 420);
  assert.equal(sidebarWidth(600, 900), 420);
  assert.equal(sidebarLimit(390), 220);
  assert.equal(sidebarWidth(Infinity, 1280), 270);
  assert.equal(sidebarWidth(335.8, 1280), 336);
});
test('route missing is distinguished from an inaccessible or archived page', () => {
  assert.match(notebookError(new NotebookApiError(404, 'Not Found'), false), /Restart the backend/);
  assert.match(notebookError(new NotebookApiError(404, 'Not Found'), true), /khởi động lại/);
  assert.equal(notebookError(new NotebookApiError(404, 'Page not found or access denied'), false), 'Page not found or access denied');
  assert.equal(notebookError(new NotebookApiError(403, 'Not Found'), false), 'Not Found');
});
test('notebook API preserves credentials and typed server failures', async t => {
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, '/api/collab/pages/sample/sharing');
    assert.equal(init.credentials, 'include');
    return { ok: false, status: 404, json: async () => ({ detail: 'Not Found' }) };
  });
  await assert.rejects(notebookApi('', '/pages/sample/sharing'), reason => reason instanceof NotebookApiError && reason.status === 404);
});
test('global dark typography does not override block colors or notebook popovers', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  const defaults = css.split('\n').filter(line => line.startsWith("html[data-theme='dark'] :is(") && /\(p,small\)|\(h1,h2,h3,h4\)/.test(line));
  assert.equal(defaults.length, 2);
  for (const line of defaults) {
    assert.match(line, /:not\(:where\(\.bn-container \*, \.notebook-share-dialog \*, \.notebook-activity-panel \*, \.notebook-tab-picker \*\)\)/);
  }
  const cards = await readFile(new URL('../src/CollaborationHub.css', import.meta.url), 'utf8');
  assert.match(cards, /\.collab-card p:not\(:where\(\.bn-container \*\)\)/);
  assert.doesNotMatch(cards, /\.collab-card p\s*\{/);
});
