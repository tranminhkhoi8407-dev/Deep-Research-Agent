import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
async function module(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}
const { projectWorkspaceRoute, projectHash, projectPaneAllowed, projectTree, restoreProjectMemory, isProjectPageHash } = await module('../src/projectNavigation.ts');
const { restoreTabs, visitTab } = await module('../src/workspaceTabs.ts');
const project = 'a'.repeat(32), page = 'b'.repeat(32), child = 'c'.repeat(32);

test('project tools preserve the editor page in their route and direct page links still work', () => {
  assert.deepEqual(projectWorkspaceRoute(projectHash(project)), { projectId: project, pageId: null, pane: 'overview' });
  for (const pane of ['overview', 'tasks', 'evidence', 'members', 'activity', 'settings', 'archived']) {
    assert.deepEqual(projectWorkspaceRoute(projectHash(project, pane, page)), { projectId: project, pageId: page, pane });
  }
  assert.deepEqual(projectWorkspaceRoute(projectHash(project, 'pages', page)), { projectId: null, pageId: page, pane: 'pages' });
});
test('routes reject foreign URLs, malformed ids, duplicate or unknown parameters', () => {
  for (const hash of ['#/collab', '#/collab/group/' + project, '#/collab/project/invalid', '#/collab/page/' + page + '?view=tasks', '#/collab/project/' + project + '/child', '#/collab/project/' + project + '?view=oops', '#/collab/project/' + project + '?view=tasks&view=pages', '#/collab/project/' + project + '?page=', '#/collab/project/' + project + '?view=', '#/collab/project/' + project + '?next=https://example.com', '#/collab/project/' + project + '?page=' + page + '#' ]) {
    assert.equal(projectWorkspaceRoute(hash), null, hash);
  }
  assert.throws(() => projectHash('invalid'));
  assert.throws(() => projectHash(project, 'tasks', 'other'));
});
test('a page-only grant cannot show project tools; managers alone see settings and trash', () => {
  assert.equal(projectPaneAllowed('pages', 0), true);
  for (const pane of ['overview', 'tasks', 'evidence', 'members', 'activity', 'settings', 'archived']) assert.equal(projectPaneAllowed(pane, 0), false);
  for (const pane of ['overview', 'tasks', 'evidence', 'members', 'activity']) assert.equal(projectPaneAllowed(pane, 1), true);
  for (const pane of ['settings', 'archived']) {
    assert.equal(projectPaneAllowed(pane, 3), false);
    assert.equal(projectPaneAllowed(pane, 4), true);
  }
});
test('sidebar nesting handles roots, orphans, collapsed branches and cyclic legacy data', () => {
  const pages = [{ id: page, parent_id: null, title: 'Root' }, { id: child, parent_id: page, title: 'Child' }, { id: 'd', parent_id: child, title: 'Leaf' }, { id: 'e', parent_id: 'missing', title: 'Orphan' }];
  assert.deepEqual(projectTree(pages).map(item => [item.page.id, item.depth]), [[page, 0], [child, 1], ['d', 2], ['e', 0]]);
  assert.deepEqual(projectTree(pages, new Set([page])).map(item => item.page.id), [page, 'e']);
  const cycle = [{ id: 'a', parent_id: 'b', title: 'A' }, { id: 'b', parent_id: 'a', title: 'B' }];
  assert.equal(new Set(projectTree(cycle).map(item => item.page.id)).size, 2);
});
test('session memory discards pages outside the authorized project and unsafe offsets', () => {
  const result = restoreProjectMemory({ pageId: 'private', scroll: { [page]: 300, [child]: -1, private: 900, nan: NaN }, collapsed: [page, page, 'private'], toolsCollapsed: true }, new Set([page, child]));
  assert.deepEqual(result, { pageId: null, scroll: { [page]: 300 }, collapsed: [page], toolsCollapsed: true });
  assert.deepEqual(restoreProjectMemory(null, new Set()), { pageId: null, scroll: {}, collapsed: [], toolsCollapsed: false });
  assert.equal(restoreProjectMemory({ scroll: { [page]: Infinity } }, new Set([page])).scroll[page], undefined);
});
test('project tabs use an explicit allowlist without widening the Fields tab allowlist', () => {
  const entry = { hash: `#/collab/page/${page}`, title: 'Proof', icon: '∑' };
  const state = visitTab(restoreTabs(null), entry, 'tab', isProjectPageHash);
  assert.equal(state.tabs.length, 1);
  assert.deepEqual(restoreTabs(state), { tabs: [], active: '' });
  assert.equal(restoreTabs(state, value => value === entry.hash).tabs.length, 1);
  assert.equal(restoreTabs(state, value => value === `#/collab/page/${child}`).tabs.length, 0);
  assert.equal(visitTab(state, { ...entry, hash: 'javascript:alert(1)' }, 'bad', isProjectPageHash), state);
});
