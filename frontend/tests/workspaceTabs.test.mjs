import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source = await readFile(new URL('../src/workspaceTabs.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { restoreTabs, visitTab, closeTab, stepTab, relativeTime, tabLimit } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const page = (field, id = 'a') => ({ hash: `#/fields/${field}/page/${id.repeat(32)}`, title: field + id, icon: '∑' });
test('new workspace tabs are independent and preserve per-tab back/forward history', () => {
  let state = visitTab(restoreTabs(null), page('mathematics'), 'first');
  state = visitTab(state, page('mathematics', 'b'));
  state = visitTab(state, page('physics'), 'second');
  assert.equal(state.tabs.length, 2);
  assert.equal(state.tabs[0].history.length, 2);
  state = { ...state, active: 'first' };
  state = stepTab(state, -1);
  assert.equal(state.tabs[0].index, 0);
  assert.equal(state.tabs[1].index, 0);
  state = stepTab(state, 1);
  assert.equal(state.tabs[0].index, 1);
  assert.deepEqual(visitTab(state, page('mathematics', 'b')), state);
});
test('branch navigation discards forward history; history is bounded', () => {
  let state = visitTab(restoreTabs(null), page('mathematics'), 'first');
  state = visitTab(state, page('mathematics', 'b'));
  state = stepTab(state, -1);
  state = visitTab(state, page('mathematics', 'c'));
  assert.equal(state.tabs[0].history.length, 2);
  assert.equal(state.tabs[0].history[1].title, 'mathematicsc');
  for (let index = 0; index < 60; index++) state = visitTab(state, page('mathematics', index % 2 ? 'a' : 'b'));
  assert.equal(state.tabs[0].history.length, 50);
  assert.equal(state.tabs[0].index, 49);
});
test('closing inactive, active and last tabs selects a valid neighbor', () => {
  let state = visitTab(restoreTabs(null), page('mathematics'), 'first');
  state = visitTab(state, page('physics'), 'second');
  state = visitTab(state, page('chemistry'), 'third');
  state = closeTab(state, 'first');
  assert.equal(state.active, 'third');
  state = closeTab(state, 'third');
  assert.equal(state.active, 'second');
  state = closeTab(state, 'second');
  assert.deepEqual(state, { tabs: [], active: '' });
});
test('restoration rejects corrupt, duplicate, external and oversized history entries', () => {
  assert.deepEqual(restoreTabs({ tabs: [{ id: 'a', history: [{ hash: 'https://example.com', title: 'x', icon: '' }], index: 0 }] }), { tabs: [], active: '' });
  const tab = { id: 'a', history: [page('mathematics')], index: 100 };
  const restored = restoreTabs({ tabs: [null, tab, tab], active: 'missing' });
  assert.equal(restored.tabs.length, 1);
  assert.equal(restored.active, 'a');
  assert.equal(restored.tabs[0].index, 0);
  assert.deepEqual(restoreTabs({ tabs: [{ ...tab, history: Array(51).fill(page('physics')) }] }), { tabs: [], active: '' });
});
test('tab limit and invalid route cannot mutate current workspace', () => {
  let state = restoreTabs(null);
  for (let index = 0; index < tabLimit; index++) state = visitTab(state, page('mathematics'), String(index));
  assert.equal(visitTab(state, page('physics'), 'excess'), state);
  assert.equal(visitTab(state, { hash: '#/fields/mathematics/page/invalid', title: 'Bad', icon: '' }), state);
});
test('Edited relative time handles minutes, hours, future clocks and invalid dates', () => {
  const now = Date.parse('2026-10-05T12:00:00Z');
  assert.equal(relativeTime('2026-10-05T11:46:00Z', false, now), '14m ago');
  assert.equal(relativeTime('2026-10-05T10:00:00Z', true, now), '2 giờ trước');
  assert.equal(relativeTime('2026-10-06T10:00:00Z', false, now), 'just now');
  assert.equal(relativeTime('invalid', true, now), 'không rõ thời gian');
});
