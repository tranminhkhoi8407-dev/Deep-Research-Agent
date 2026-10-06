import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
async function module(name) {
  const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}
const { inlineEquationInput, inlineEquationParts, equationSource, freshBlockCopy, mathMarkdownProjection, blockTextStats } = await module('notebookMath');
const { stageFieldTour, consumeFieldTour, withoutTourHandoff, handoffLifetime } = await module('tourHandoff');
const token = '12345678-1234-4123-8123-123456789012';
const { editorFormulas } = await module('editorGuideContent');
const { default: katex } = await import('katex');
await import('katex/contrib/mhchem');
test('all guide formulas render with supported KaTeX, no invalid commands', () => {
  assert.equal(new Set(editorFormulas.map(item => item.id)).size, editorFormulas.length);
  assert.equal(editorFormulas.length, 65);
  const counts = editorFormulas.reduce((result, item) => ({ ...result, [item.category]: (result[item.category] || 0) + 1 }), {});
  assert.deepEqual(counts, { basics: 15, math: 10, physics: 10, chemistry: 10, biology: 10, ai: 10 });
  for (const item of editorFormulas) assert.ok(katex.renderToString(item.source, { throwOnError: true, displayMode: true, trust: false, strict: 'error' }).includes('katex'), item.id);
});
test('block statistics count own Unicode content, equations and tables, not descendants', () => {
  assert.deepEqual(blockTextStats({ content: [{ type: 'text', text: 'Hello 🧬 ' }, { type: 'math', content: 'x^2' }], children: [{ content: 'Ignore' }] }), { words: 3, characters: 11 });
  assert.deepEqual(blockTextStats({ content: { type: 'tableContent', rows: [{ cells: [[{ text: 'One' }], [{ text: 'Two' }]] }] } }), { words: 2, characters: 7 });
  assert.deepEqual(blockTextStats({ type: 'pageLink', props: { title: 'Research notes' } }), { words: 2, characters: 14 });
});
test('page references keep their destinations in Markdown projections', () => {
  const result = mathMarkdownProjection([{ type: 'pageLink', props: { pageId: 'abc', title: 'Notes' }, children: [] }], 'n');
  assert.equal(result.blocks[0].content[0].href, '#/collab/page/abc');
  assert.equal(result.blocks[0].content[0].content[0].text, 'Notes');
});
function store() { const rows = new Map(); return { getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value), removeItem: key => rows.delete(key) }; }

test('field tour crosses into the chosen field once, without changing the route', () => {
  for (const field of ['mathematics', 'physics', 'chemistry', 'biology', 'artificial-intelligence']) {
    const storage = store();
    const url = new URL(stageFieldTour(new URL(`https://app.test/?keep=1#/fields/${field}`), 'alice', field, token, storage, 1000));
    assert.equal(url.hash, `#/fields/${field}`);
    assert.equal(consumeFieldTour(url, 'bob', field, storage, 1001), null);
    assert.equal(consumeFieldTour(url, 'alice', 'other-field', storage, 1001), null);
    assert.equal(consumeFieldTour(url, 'alice', field, storage, 1001)?.step, 1);
    assert.equal(consumeFieldTour(url, 'alice', field, storage, 1001), null);
    assert.equal(withoutTourHandoff(url), `/?keep=1#/fields/${field}`);
    assert.equal(consumeFieldTour(new URL(`https://app.test/#/fields/${field}`), 'alice', field, storage), null);
  }
});
test('handoff rejects stale, future, missing, malformed, and inaccessible storage', () => {
  for (const now of [999, 1001 + handoffLifetime]) {
    const storage = store();
    const url = new URL(stageFieldTour(new URL('https://app.test/#/fields/physics'), 'a', 'physics', token, storage, 1000));
    assert.equal(consumeFieldTour(url, 'a', 'physics', storage, now), null);
  }
  const url = new URL(`https://app.test/?workspaceTour=${token}#/fields/physics`);
  const storage = store(); storage.setItem('nexora-tour-handoff:' + token, 'bad json');
  assert.equal(consumeFieldTour(url, 'a', 'physics', storage), null);
  assert.equal(consumeFieldTour(url, 'a', 'physics', { ...store(), getItem() { throw Error('denied'); } }), null);
});
test('double-dollar equations convert only on a complete, nonempty pair', () => {
  assert.equal('Before $$x^2 + y^2$$'.match(inlineEquationInput)?.[1], 'x^2 + y^2');
  for (const text of ['$x$', '$100', '$$x$', '\\$$x$$', '$$$x$$', '$$x\ny$$']) assert.equal(inlineEquationInput.test(text), false);
  assert.deepEqual(inlineEquationParts('A $$x^2$$ and $$\\frac{1}{2}$$.'), [{ type: 'text', text: 'A ' }, { type: 'math', content: 'x^2' }, { type: 'text', text: ' and ' }, { type: 'math', content: '\\frac{1}{2}' }, { type: 'text', text: '.' }]);
  for (const text of ['Costs $100', '$$ $$', '$$unclosed', '\\$$escaped$$', '$$$x$$$']) assert.deepEqual(inlineEquationParts(text), [{ type: 'text', text }]);
});
test('Turn into equation keeps nested inline source; duplicate never reuses IDs', () => {
  assert.equal(equationSource([{ type: 'text', text: 'E = ' }, { type: 'math', content: 'mc^2' }, { type: 'link', content: [{ type: 'text', text: ' + c' }] }]), 'E = mc^2 + c');
  const block = { id: 'parent', type: 'paragraph', content: [{ type: 'text', text: 'Keep me', styles: { bold: true } }], children: [{ id: 'child', type: 'paragraph', children: [] }] };
  const copy = freshBlockCopy(block);
  assert.equal(copy.id, undefined); assert.equal(copy.children[0].id, undefined);
  assert.deepEqual(copy.content, block.content); assert.equal(block.children[0].id, 'child');
});

test('Markdown exports preserve raw inline and display LaTeX without changing the document', () => {
  const formula = { type: 'math', props: {}, content: '\\frac{x_1}{2}' };
  const display = { id: 'equation', type: 'mathBlock', content: [{ type: 'text', text: '\\int_0^1 x^2\\,dx', styles: {} }], children: [] };
  const blocks = [{ type: 'paragraph', content: [{ type: 'link', href: 'https://example.test', content: [formula] }], children: [display] }, { type: 'table', content: { type: 'tableContent', rows: [{ cells: [[formula]] }] } }, { type: 'codeBlock', content: [{ type: 'text', text: '$$literal$$', styles: {} }] }];
  const original = JSON.stringify(blocks);
  const projection = mathMarkdownProjection(blocks, 'test-nonce');
  assert.equal(JSON.stringify(blocks), original);
  assert.equal(projection.blocks[0].children[0].type, 'paragraph');
  assert.equal(projection.blocks[2].content[0].text, '$$literal$$');
  const tokens = [projection.blocks[0].content[0].content[0].text, projection.blocks[0].children[0].content[0].text, projection.blocks[1].content.rows[0].cells[0][0].text];
  assert.equal(new Set(tokens).size, 3);
  assert.equal(projection.restore(tokens.join('\n\n')), '$$\\frac{x_1}{2}$$\n\n$$\n\\int_0^1 x^2\\,dx\n$$\n\n$$\\frac{x_1}{2}$$');
});
