import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/researchForm.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { hasResearchInput, researchOutcome } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('paper accepts an uploaded PDF without a prompt or with a short focus', () => {
  for (const topic of ['', ' \n ', 'SQL', 'Explain the methods']) {
    assert.equal(hasResearchInput(topic, { mode: 'paper', paperInput: '', documentId: 'selected-pdf' }), true);
  }
});

test('paper accepts a URL, arXiv ID or DOI without a prompt', () => {
  for (const paperInput of ['https://arxiv.org/abs/2605.03465v1', '2605.03465v1', '10.1234/test']) {
    assert.equal(hasResearchInput('', { mode: 'paper', paperInput, documentId: '' }), true);
  }
});

test('paper still requires a source even when a long prompt exists', () => {
  assert.equal(hasResearchInput('Analyze this paper carefully', { mode: 'paper', paperInput: ' \n ', documentId: ' ' }), false);
});

test('research still requires a topic after switching away from paper mode', () => {
  const options = { mode: 'research', paperInput: '2605.03465v1', documentId: 'selected-pdf' };
  for (const topic of ['', ' \n ', 'SQL', '1234567']) assert.equal(hasResearchInput(topic, options), false);
  assert.equal(hasResearchInput('12345678', options), true);
});

test('zero-claim structured reports, including old saved reports, are failures', () => {
  assert.equal(researchOutcome({ sections: [], coverage: [{ status: 'answered' }] }), 'failed');
  assert.equal(researchOutcome({ sections: [{ key: 'scope', claims: [{}] }], coverage: [] }), 'failed');
});

test('incomplete questions or missing substantive sections produce partial status', () => {
  const sections = ['answer', 'mechanism', 'evidence', 'limitations', 'next_steps'].map(key => ({ key, claims: [{ verification: 'model_checked' }] }));
  assert.equal(researchOutcome({ sections, coverage: [{ status: 'partial' }] }), 'partial');
  assert.equal(researchOutcome({ sections: sections.slice(0, 1), coverage: [{ status: 'answered' }] }), 'partial');
  assert.equal(researchOutcome({ sections, coverage: [{ status: 'answered' }] }), 'completed');
  assert.equal(researchOutcome({ sections, coverage: [] }), 'partial');
  assert.equal(researchOutcome({ sections: [{ key: 'answer', claims: [{ verification: 'quote_matched' }] }, ...sections.slice(1)], coverage: [{ status: 'answered' }] }), 'partial');
});

test('explicit new outcomes and Markdown-only legacy reports remain readable', () => {
  assert.equal(researchOutcome(null), 'completed');
  assert.equal(researchOutcome({ outcome: 'failed', sections: [], coverage: [] }), 'failed');
  assert.equal(researchOutcome({ outcome: 'partial', sections: [], coverage: [] }), 'partial');
});
