import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source = await readFile(new URL('../src/fieldNavigation.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { fieldRoute, fieldHash, fieldIds, pageAncestors, pageDescendants } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
test('all five field homes and deep links round trip', () => {
  for (const field of fieldIds) {
    assert.deepEqual(fieldRoute(fieldHash(field)), { field, pageId: null });
    assert.deepEqual(fieldRoute(fieldHash(field, 'a'.repeat(32))), { field, pageId: 'a'.repeat(32) });
  }
  for (const route of ['#/fields', '#/fields/unknown', '#/fields/math', '#/fields/physics/page/invalid', '#/fields/physics?x=1', '#/fields/physics/page/' + 'a'.repeat(32) + '/other']) assert.equal(fieldRoute(route), null);
});
test('breadcrumbs and move exclusions handle deep trees and corrupt cycles safely', () => {
  const pages = [{ id: 'home', parent_id: null }, { id: 'a', parent_id: 'home' }, { id: 'b', parent_id: 'a' }, { id: 'c', parent_id: 'b' }, { id: 'other', parent_id: 'home' }];
  assert.deepEqual(pageAncestors(pages, 'c').map(p => p.id), ['home', 'a', 'b', 'c']);
  assert.deepEqual([...pageDescendants(pages, 'a')], ['a', 'b', 'c']);
  assert.deepEqual(pageAncestors(pages, 'missing'), []);
  const cycle = [{ id: 'a', parent_id: 'b' }, { id: 'b', parent_id: 'a' }];
  assert.equal(pageAncestors(cycle, 'a').length, 2);
  assert.equal(pageDescendants(cycle, 'a').size, 2);
});
