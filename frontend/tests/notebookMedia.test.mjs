import assert from 'node:assert/strict';
import { test } from 'node:test';
import { notebookImageWidth, notebookMediaError, resizedNotebookImageWidth, safeNotebookURL } from '../src/notebookMediaModel.ts';
test('notebook URL cards accept only credential-free HTTP(S), never executable or oversized input', () => {
  assert.equal(safeNotebookURL('https://example.com/guide?a=1'), 'https://example.com/guide?a=1');
  for (const value of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'file:///C:/secret', 'ftp://example.com/file', 'https://user:pass@example.com', 'https://example.com/\nfoo', 'x'.repeat(2049), 'not-a-url']) assert.equal(safeNotebookURL(value), '');
  assert.match(notebookMediaError('notebook_image_url_failed', true), /địa chỉ nội bộ/);
  assert.match(notebookMediaError('notebook_image_invalid', false), /static PNG/);
});
test('image widths are bounded, responsive percentages and centered resizing preserves limits', () => {
  assert.equal(notebookImageWidth(undefined), 100);
  assert.equal(notebookImageWidth('50'), 100);
  for (const value of [NaN, Infinity, -Infinity]) assert.equal(notebookImageWidth(value), 100);
  assert.equal(notebookImageWidth(0), 25);
  assert.equal(notebookImageWidth(150), 100);
  assert.equal(notebookImageWidth(48.7), 49);
  assert.equal(resizedNotebookImageWidth(50, -100, 800), 25);
  assert.equal(resizedNotebookImageWidth(50, 100, 800), 75);
  assert.equal(resizedNotebookImageWidth(50, 1000, 800), 100);
  assert.equal(resizedNotebookImageWidth(50, 100, 0), 50);
});
