import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source = await readFile(new URL('../src/researchVisualModel.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { numericValue, orderedRows, componentEvidence, documentIdFor, originalPageUrl, visualGenerationStatus, visualStatusMessage } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
test('missing and invalid numbers are never plotted as zero', () => {
  for (const value of ['', ' ', 'N/A', 'Infinity', 'NaN', '55%', '1e3', '-5', '1+2', '123abc']) assert.equal(numericValue(value), null);
  for (const [value, expected] of [['0', 0], ['67,73', 67.73], ['55.02', 55.02]]) assert.equal(numericValue(value), expected);
});
test('the real legacy failure visuals.0 is a format defect, not missing evidence', () => {
  const old = { visuals: [], diagnostics: [{ kind: 'invalid_items', fields: ['visuals.0'] }] };
  assert.equal(visualGenerationStatus(old).status, 'invalid_structure');
  assert.match(visualStatusMessage('invalid_structure', true).title, /lỗi định dạng/);
  assert.match(visualStatusMessage('invalid_structure', false).title, /Invalid visual structure/);
  assert.equal(visualGenerationStatus({ visuals: [] }).status, 'not_generated');
});
test('new empty-visual reasons stay distinct in both languages', () => {
  const statuses = ['not_generated', 'invalid_structure', 'source_rejected', 'audit_rejected', 'audit_unavailable', 'budget_exhausted', 'insufficient_evidence', 'generation_failed'];
  for (const vi of [true, false]) assert.equal(new Set(statuses.map(status => visualStatusMessage(status, vi).title)).size, statuses.length);
  const status = { status: 'budget_exhausted', attempts: 1, budget_kind: 'input_budget', issues: [{ field: 'visuals.0.nodes.1.id', code: 'string_pattern_mismatch' }] };
  assert.equal(visualGenerationStatus({ visual_status: status }).status, 'budget_exhausted');
  assert.deepEqual(visualGenerationStatus({ visual_status: status }).issues, status.issues);
});
test('sort preserves source-row identity and never modifies original data', () => {
  const rows = [{ cells: ['Beta', '55.02'] }, { cells: ['Alpha', '67.73'] }, { cells: ['Missing', 'N/A'] }];
  assert.deepEqual(orderedRows(rows, 'descending').map(item => item.sourceIndex), [1, 0, 2]);
  assert.equal(rows[0].cells[0], 'Beta');
});
test('legacy aggregate evidence is explicit, not mislabeled as node-level support', () => {
  const visual = { evidence: [{ chunk_id: 'All', quote: 'Whole figure evidence.' }], verification: 'model_checked' };
  const own = [{ chunk_id: 'Node', quote: 'Specific node evidence.' }];
  assert.equal(componentEvidence(visual, 'Node', 'Description').aggregate, true);
  const selected = componentEvidence(visual, 'Node', 'Description', own);
  assert.equal(selected.aggregate, false); assert.deepEqual(selected.evidence, own);
});
test('original preview uses owned document ids and bounded pages, never arbitrary URLs', () => {
  const id = 'a'.repeat(64);
  assert.equal(documentIdFor({ url: `/api/research/documents/${id}/content` }), id);
  assert.equal(documentIdFor({ url: 'https://attacker.example/file.pdf' }), null);
  assert.equal(originalPageUrl('/backend', id, 3, 'image'), `/backend/api/research/documents/${id}/pages/3/image`);
  for (const page of [0, 101, 1.5, NaN]) assert.equal(originalPageUrl('', id, page, 'locate'), null);
  assert.equal(originalPageUrl('', '../secrets', 1, 'image'), null);
});
