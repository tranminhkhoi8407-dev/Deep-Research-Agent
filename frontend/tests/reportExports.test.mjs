import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source = await readFile(new URL('../src/reportExports.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { arxivisualUrl, reportExportUrl, fetchReportArtifact } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

test('external connector validates public arXiv identifiers and preserves versions', () => {
  for (const value of ['2605.03465v1', 'https://arxiv.org/abs/2605.03465v1', 'https://arxiv.org/pdf/2605.03465v1.pdf']) assert.equal(arxivisualUrl(value), 'https://www.arxivisual.org/abs/2605.03465v1');
  for (const value of ['file:///secret.pdf', 'https://evil.example/2605.03465', 'https://user:password@arxiv.org/abs/2605.03465', 'https://arxiv.org/abs/2605.03465?secret=x']) assert.equal(arxivisualUrl(value), null);
});
test('export URL encodes report ids and requests the chosen artifact', () => {
  assert.equal(reportExportUrl('/backend', 'report with spaces.md', 'tex'), '/backend/api/reports/report%20with%20spaces.md/export?format=tex');
});
test('compiler failures remain explicit instead of producing a fake download', async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: false, json: async () => ({ detail: { code: 'compiler_unavailable', message: 'PDF compiler unavailable' } }) });
    await assert.rejects(fetchReportArtifact('', 'record.md', 'pdf'), /PDF compiler unavailable/);
  } finally { globalThis.fetch = previous; }
});

test('an HTML login page or mislabeled invalid PDF cannot become a report download', async () => {
  const previous = globalThis.fetch;
  try {
    for (const blob of [new Blob(['<html>Login</html>'], { type: 'text/html' }), new Blob(['Not a PDF'], { type: 'application/pdf' }), new Blob([], { type: 'application/pdf' })]) {
      globalThis.fetch = async () => ({ ok: true, blob: async () => blob });
      await assert.rejects(fetchReportArtifact('', 'record.md', 'pdf'), /did not return/);
    }
    const good = new Blob(['%PDF-real-header-fixture'], { type: 'application/pdf' });
    globalThis.fetch = async () => ({ ok: true, blob: async () => good });
    assert.equal(await fetchReportArtifact('', 'record.md', 'pdf'), good);
  } finally { globalThis.fetch = previous; }
});
