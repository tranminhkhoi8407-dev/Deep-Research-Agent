import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/social.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { relationshipAction, notificationText, relativeTime, roleLabel, safeSocialHref } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('friend actions distinguish received, sent and accepted relationships', () => {
  assert.equal(relationshipAction(), 'add');
  assert.equal(relationshipAction({ status: 'pending', direction: 'incoming' }), 'respond');
  assert.equal(relationshipAction({ status: 'pending', direction: 'outgoing' }), 'cancel');
  for (const direction of ['incoming', 'outgoing']) assert.equal(relationshipAction({ status: 'accepted', direction }), 'friends');
});

test('only allowlisted internal destinations can be opened by a notification', () => {
  for (const kind of ['project', 'page', 'group']) assert.equal(safeSocialHref(`#/collab/${kind}/${'a'.repeat(32)}`), `#/collab/${kind}/${'a'.repeat(32)}`);
  assert.equal(safeSocialHref('#/collab/people'), '#/collab/people');
  for (const href of [null, 'https://evil.example', 'javascript:alert(1)', '//example.com', '#/admin', '#/collab/project/123', '#/collab/page/' + 'a'.repeat(32) + '?redirect=1']) assert.equal(safeSocialHref(href), null);
});

test('unavailable notifications never disclose saved actors or titles', () => {
  for (const state of ['expired', 'unavailable']) {
    const item = { state, kind: 'invite.received', actor: { display_name: 'Private actor' }, title: 'Secret report' };
    for (const vi of [true, false]) assert.doesNotMatch(notificationText(item, vi), /Private actor|Secret report/);
  }
});

test('notification text and role descriptions work in Vietnamese and English', () => {
  const item = { state: 'pending', kind: 'friend.request', actor: { display_name: 'Khôi' }, title: '' };
  assert.match(notificationText(item, true), /Khôi muốn kết bạn/);
  assert.match(notificationText(item, false), /Khôi sent you a friend request/);
  assert.equal(roleLabel('editor', true), 'Có thể chỉnh sửa');
  assert.equal(roleLabel('viewer', false), 'Can view');
  assert.equal(roleLabel(null, true), '');
});

test('relative times handle future timestamps and invalid dates safely', () => {
  const now = Date.parse('2026-10-12T12:00:00Z');
  assert.equal(relativeTime('2026-10-12T11:45:00Z', true, now), '15 phút trước');
  assert.equal(relativeTime('2026-10-12T10:00:00Z', false, now), '2h ago');
  assert.equal(relativeTime('2026-10-12T12:30:00Z', true, now), 'Vừa xong');
  assert.equal(relativeTime('invalid', true, now), '');
});
