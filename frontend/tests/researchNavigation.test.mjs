import assert from 'node:assert/strict';
import { test } from 'node:test';
import { researchHash, researchScreenFromHash } from '../src/researchNavigation.ts';

test('Research always resolves to chat, reports is an explicit child', () => {
  assert.equal(researchScreenFromHash('#/research'), 'chat');
  assert.equal(researchScreenFromHash('#/research/chat'), 'chat');
  assert.equal(researchScreenFromHash('#/research/reports'), 'classic');
  assert.equal(researchHash('chat'), '#/research');
  assert.equal(researchHash('classic'), '#/research/reports');
});

test('report creation is distinct from global report library and unrelated routes', () => {
  for (const hash of ['', '#/library', '#/profile', '#/research/not-a-view', '#/research/reports/other']) assert.equal(researchScreenFromHash(hash), null);
});
