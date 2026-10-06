import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

// Test the pure route helpers without adding a browser runner or dependencies.
const source = await readFile(new URL('../src/profileNavigation.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { profileCompletionFromHash, profileSetupHash } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('profile setup preserves field and notebook deep links across reloads', () => {
  for (const field of [null, 'mathematics', 'physics', 'chemistry', 'biology', 'artificial-intelligence']) {
    for (const returnHash of ['#/collab', `#/collab/page/${'a'.repeat(32)}`, `#/collab/project/${'b'.repeat(32)}`, '#/fields', ...(field ? [`#/fields/${field}`, `#/fields/${field}/page/${'a'.repeat(32)}`] : [])]) {
      const request = { returnHash, field };
      assert.deepEqual(profileCompletionFromHash(profileSetupHash(request)), request);
    }
  }
});

test('only allowlisted internal notebook routes are return destinations', () => {
  for (const returnHash of ['https://example.com', '//example.com', '#/admin', '#/collab/page/invalid', '#/collab?script=1']) {
    assert.equal(profileCompletionFromHash(`#/profile?complete=name&return=${encodeURIComponent(returnHash)}`), null);
    assert.equal(profileCompletionFromHash(profileSetupHash({ returnHash, field: null })).returnHash, '#/collab');
  }
  assert.equal(profileCompletionFromHash('#/profile'), null);
  assert.equal(profileCompletionFromHash('#/profile?complete=something-else'), null);
  assert.deepEqual(profileCompletionFromHash('#/profile?complete=name&field=unknown'), { returnHash: '#/collab', field: null });
});
