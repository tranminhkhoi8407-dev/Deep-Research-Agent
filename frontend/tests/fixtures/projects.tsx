/* Test-only entrypoint. Every API and live connection is in-memory, never a real account. */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BlockNoteEditor } from '@blocknote/core';
import { blocksToYDoc } from '@blocknote/core/yjs';
import * as Y from 'yjs';
import { CollaborationHub, type Group, type ProjectDetail } from '../../src/CollaborationHub';
import { SocialProvider } from '../../src/SocialCenter';
import { projectWorkspaceRoute } from '../../src/projectNavigation';
import type { Appearance, AuthUser } from '../../src/Auth';
import type { Language } from '../../src/ProductViews';
import '../../src/styles.css';
import '../../src/design.css';
import '../../src/dark-mode.css';

const projectId = 'a'.repeat(32), rootId = 'b'.repeat(32), childId = 'c'.repeat(32), otherId = 'd'.repeat(32), timestamp = new Date().toISOString();
const parameters = new URLSearchParams(location.search);
const qa = { mode: parameters.get('mode') || 'manager', requests: [] as { path: string; method: string; body: Record<string, unknown> }[], connections: 0, holdAcks: false, failNext: parameters.has('fail') ? 1 : 0, failGroupCreates: 0, failGroupRefreshes: 0, failGroupArchives: 0 };
(window as unknown as { projectQA: typeof qa }).projectQA = qa;
const user: AuthUser = { id: 'fixture-user', name: 'Khoi', public_name: 'Khoi', username: null, provider: 'local', email: 'fixture@example.invalid', avatar_url: null, role: 'member', status: 'active', license_type: 'free', license_expires_at: null };
const person = { id: user.id, public_name: 'Khoi', display_name: 'Khoi', avatar_url: null };
const recipient = { id: 'fixture-recipient', public_name: '123', display_name: '123', avatar_url: null };
const groupRole: Group['my_role'] = parameters.get('groupRole') === 'owner' ? 'owner' : parameters.get('groupRole') === 'member' ? 'member' : 'admin';
const groups: Group[] = parameters.has('groups') ? [{ id: 'e'.repeat(32), name: 'AI Lab', description: 'Existing group with two members', my_role: groupRole, members: [{ ...person, role: groupRole }, { ...recipient, role: groupRole === 'owner' ? 'member' : 'owner' }], pending_invites: [{ id: 'group-invite', role: 'member', recipient }] }] : [];
const archivedGroups: Group[] = [];
const data: ProjectDetail = {
  owner: person,
  project: { id: projectId, name: 'FINER-SQL Research', description: 'Hiểu cơ chế, đối chiếu bằng chứng và xây dựng thử nghiệm tái lập.', field: 'artificial-intelligence', category: 'Paper analysis', group_id: null, status: 'active', visibility: 'restricted', my_access: 4, updated_at: timestamp },
  home_page_id: null,
  pages: [
    { id: rootId, title: 'Phân tích FINER-SQL', parent_id: null, position: 0, icon: '🔬', cover: 'indigo', project_id: projectId, updated_at: timestamp, favorite: true },
    { id: childId, title: 'Bốn thành phần reward', parent_id: rootId, position: 0, icon: '🎯', project_id: projectId, updated_at: timestamp },
    { id: otherId, title: 'Thử nghiệm tái lập', parent_id: null, position: 1, icon: '', project_id: projectId, updated_at: timestamp },
  ], archived_pages: [], tasks: [{ id: 'task-1', title: 'Đối chiếu ablation với bảng kết quả', status: 'todo', assignee: person }],
  evidence: [{ id: 'source-1', title: 'FINER-SQL', url: 'https://example.invalid/paper', doi: '', note: 'Nguồn được chia sẻ chủ động' }],
  members: [{ ...person, role: 'editor' }], assignable: [person], pending_invites: parameters.has('invites') ? [{ id: 'project-invite', role: 'editor', recipient }] : [],
};
const documentMap = new Map<string, Y.Doc>();
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const editor = BlockNoteEditor.create();
const seed = (id: string) => {
  if (!documentMap.has(id)) documentMap.set(id, blocksToYDoc(editor, Array.from({ length: id === rootId ? 26 : 2 }, (_, index) => ({ type: 'paragraph' as const, content: index === 0 ? 'Bản nháp nghiên cứu: phân biệt huấn luyện và suy luận.' : `Đoạn ${index}: Đọc phương pháp, baseline và điều kiện đánh giá trước khi diễn giải kết quả.` })), 'notebook'));
  return documentMap.get(id)!;
};
const projectAccess = () => qa.mode === 'guest' ? 0 : qa.mode === 'viewer' ? 1 : qa.mode === 'editor' ? 3 : 4;
const pageAccess = () => qa.mode === 'viewer' ? 1 : qa.mode === 'guest' ? 3 : projectAccess();
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin);
  if (!url.pathname.startsWith('/__project-fixture/')) return nativeFetch(input, init);
  const path = url.pathname.replace(/^\/__project-fixture\/api(?:\/collab)?/, ''), method = init?.method || 'GET', body = JSON.parse(String(init?.body || '{}'));
  qa.requests.push({ path, method, body });
  const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  if (qa.mode === 'revoked') return reply({ detail: 'Not Found' }, 404);
  if (path === '/notifications/count') return reply({ unread_count: 2 });
  if (path === '/projects/' + projectId) {
    if (!projectAccess()) return reply({ detail: 'Not Found' }, 404);
    if (qa.failNext > 0) { qa.failNext--; return reply({ detail: 'Temporary test outage' }, 503); }
    if (method === 'PATCH') Object.assign(data.project, body);
    return reply({ ...data, project: { ...data.project, my_access: projectAccess() }, pages: data.pages.map(page => ({ ...page, my_access: pageAccess() })) });
  }
  if (path === `/projects/${projectId}/pages` && method === 'POST') {
    const page = { id: crypto.randomUUID().replaceAll('-', ''), project_id: projectId, parent_id: body.parent_id as string || null, title: String(body.title), updated_at: timestamp, my_access: pageAccess() };
    data.pages.push(page); return reply({ page }, 201);
  }
  if (path === `/projects/${projectId}/tasks` && method === 'POST') { data.tasks.unshift({ id: crypto.randomUUID(), title: String(body.title), status: 'todo', assignee: null }); return reply({ task: data.tasks[0] }, 201); }
  if (path === `/projects/${projectId}/activity`) return reply({ events: [] });
  if (path === '/search-pages') return reply({ pages: data.pages.filter(page => page.title.includes(url.searchParams.get('query') || '')).map(page => ({ ...page, project_name: data.project.name, snippet: '' })) });
  const match = /^\/pages\/([a-f0-9]{32})(?:\/(.*))?$/.exec(path);
  if (match) {
    const page = data.pages.find(item => item.id === match[1]), action = match[2];
    if (!page || qa.mode === 'guest' && page.id !== rootId) return reply({ detail: 'Not Found' }, 404);
    if (!action) {
      if (method === 'PATCH') Object.assign(page, body);
      return reply({ page: { ...page, my_access: pageAccess(), can_manage: projectAccess() >= 4 }, project: { ...data.project, my_access: projectAccess() }, comments: [], versions: [], shares: [], pending_invites: [], last_editor: person });
    }
    if (action === 'document') return reply({ format: 'blocks', revision: 0, update: encode(Y.encodeStateAsUpdate(seed(page.id))), legacy_markdown: '' });
    if (action === 'references') return reply({ pages: projectAccess() ? data.pages : [], evidence: projectAccess() ? data.evidence : [], backlinks: [] });
    if (action === 'preference') { page.favorite = Boolean(body.favorite); return reply({ favorite: page.favorite }); }
    if (action === 'activity') return reply({ created_by: person, edited_by: person, created_at: timestamp, edited_at: timestamp, can_analyze: pageAccess() >= 3, updates: [] });
    if (action === 'view') return reply({ recorded: true, show_history: false });
    if (action === 'sharing') return reply({ can_manage: projectAccess() >= 4, members: [{ ...person, role: 'manager', inherited: true }], pending_invites: [], general_access: 'invited', project_access: !!projectAccess() });
    if (action === 'index') return reply({ indexed: true });
    if (action === 'archive') { data.pages = data.pages.filter(item => item.id !== page.id); data.archived_pages.push({ id: page.id, title: page.title, archived_at: timestamp }); return reply({ status: 'archived' }); }
    if (action === 'duplicate') { const clone = { ...page, id: crypto.randomUUID().replaceAll('-', ''), title: page.title + ' (copy)' }; data.pages.push(clone); return reply({ page: clone }, 201); }
  }
  if (path === '/projects') return reply({ projects: [data.project] });
  if (path === '/groups') {
    if (method === 'POST') {
      await new Promise(resolve => setTimeout(resolve, 150));
      if (qa.failGroupCreates > 0) { qa.failGroupCreates--; return reply({ detail: 'Group creation test failure' }, 503); }
      if (String(body.name).trim().length < 2) return reply({ detail: 'Group name too short' }, 422);
      const group: Group = { id: crypto.randomUUID().replaceAll('-', ''), name: String(body.name).trim(), description: String(body.description || '').trim(), my_role: 'owner', members: [{ ...person, role: 'owner' }], pending_invites: [] };
      groups.unshift(group); return reply({ group }, 201);
    }
    if (qa.failGroupRefreshes > 0) { qa.failGroupRefreshes--; return reply({ detail: 'Group list test failure' }, 503); }
    return reply({ groups });
  }
  if (path === '/invites/group-invite' && method === 'DELETE') { groups.forEach(group => { group.pending_invites = []; }); return reply({ status: 'cancelled' }); }
  if (path === '/invites/project-invite' && method === 'DELETE') { data.pending_invites = []; return reply({ status: 'cancelled' }); }
  if (path === '/groups/archived') return reply({ groups: archivedGroups.map(group => ({ id: group.id, name: group.name, archived_at: timestamp })) });
  const groupMatch = /^\/groups\/([a-f0-9]{32})\/(archive|restore|transfer|members\/[^/]+)$/.exec(path);
  if (groupMatch) {
    const groupId = groupMatch[1], action = groupMatch[2];
    if (action === 'restore') {
      const index = archivedGroups.findIndex(group => group.id === groupId);
      if (index < 0) return reply({ detail: 'Group not found' }, 404);
      groups.push(archivedGroups.splice(index, 1)[0]); return reply({ status: 'restored' });
    }
    const index = groups.findIndex(group => group.id === groupId), group = groups[index];
    if (!group) return reply({ detail: 'Group not found' }, 404);
    if (action === 'archive') {
      if (group.my_role !== 'owner') return reply({ detail: 'Group access required' }, 403);
      if (qa.failGroupArchives > 0) { qa.failGroupArchives--; return reply({ detail: 'Group archive test failure' }, 503); }
      archivedGroups.push(groups.splice(index, 1)[0]); return reply({ status: 'archived' });
    }
    if (action === 'transfer') {
      group.my_role = 'admin'; group.members.forEach(member => { member.role = member.public_name === body.username ? 'owner' : member.id === user.id ? 'admin' : member.role; });
      return reply({ status: 'transferred' });
    }
    if (action.startsWith('members/') && method === 'DELETE') {
      const memberId = action.split('/')[1];
      if (memberId === user.id) groups.splice(index, 1);
      else group.members = group.members.filter(member => member.id !== memberId);
      return reply({ status: 'removed' });
    }
  }
  for (const [pathName, key] of [['/connections', 'connections'], ['/invites', 'invites'], ['/shared-pages', 'pages']]) if (path === pathName) return reply({ [key]: [] });
  return reply({ detail: 'Fixture has no handler for ' + method + ' ' + path }, 404);
};
class FixtureSocket {
  static OPEN = 1;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  id: string;
  seq = 0;
  constructor(url: string) {
    this.id = url.match(/pages\/([a-f0-9]{32})/)![1]; qa.connections++;
    setTimeout(() => { this.onopen?.(); this.message({ type: 'ready', access: pageAccess(), format: 'blocks', revision: 0 }); }, 30);
  }
  message(data: object) { this.onmessage?.({ data: JSON.stringify(data) }); }
  send(raw: string) {
    const value = JSON.parse(raw);
    if (value.type === 'update') {
      Y.applyUpdate(seed(this.id), Uint8Array.from(atob(value.data), char => char.charCodeAt(0)));
      const seq = ++this.seq;
      if (!qa.holdAcks) setTimeout(() => { this.message({ type: 'update', data: value.data, seq }); this.message({ type: 'ack', id: value.id, revision: seq }); }, 60);
    }
  }
  close() { this.readyState = 3; }
}
window.WebSocket = FixtureSocket as unknown as typeof WebSocket;
function Fixture() {
  const [appearance, setAppearance] = useState<Appearance>(parameters.get('theme') === 'light' ? 'light' : 'dark'), [language, setLanguage] = useState<Language>(parameters.get('lang') === 'en' ? 'en' : 'vi'), [hash, setHash] = useState(location.hash);
  useEffect(() => { document.documentElement.dataset.theme = appearance; }, [appearance]);
  useEffect(() => { const changed = () => setHash(location.hash); window.addEventListener('hashchange', changed); return () => window.removeEventListener('hashchange', changed); }, []);
  return <SocialProvider apiBase="/__project-fixture" user={user} language={language} onEditProfile={() => {}}><div className={`app-shell app-shell--ready ${projectWorkspaceRoute(hash) ? 'app-shell--field app-shell--project' : ''}`}><main className="product-page collab-page-shell"><CollaborationHub apiBase="/__project-fixture" user={user} language={language} reports={[]} appearance={appearance} onAppearanceChange={setAppearance} onLanguageChange={setLanguage} onLogout={() => {}} onPrepareResearch={() => {}} onEditProfile={() => {}} /></main></div></SocialProvider>;
}
if (!location.hash) location.hash = `#/collab/page/${rootId}`;
createRoot(document.getElementById('root')!).render(<Fixture />);
