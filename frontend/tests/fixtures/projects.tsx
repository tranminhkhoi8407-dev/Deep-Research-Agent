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
import type { ChatMessage, Meeting } from '../../src/discussion';
import '../../src/styles.css';
import '../../src/design.css';
import '../../src/dark-mode.css';

const projectId = 'a'.repeat(32), rootId = 'b'.repeat(32), childId = 'c'.repeat(32), otherId = 'd'.repeat(32), timestamp = new Date().toISOString();
const parameters = new URLSearchParams(location.search);
const qa = { mode: parameters.get('mode') || 'manager', requests: [] as { path: string; method: string; query: string; body: Record<string, unknown> }[], connections: 0, holdAcks: false, failNext: parameters.has('fail') ? 1 : 0, failGroupCreates: 0, failGroupRefreshes: 0, failGroupArchives: 0, failChatAfterSave: 0, failMeetingSaves: 0, imageUploads: 0, failImageUpload: false, holdImageUpload: false };
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
  if (!documentMap.has(id) && parameters.has('media')) { const saved = sessionStorage.getItem('__media-qa-document:' + id); if (saved) { const doc = new Y.Doc(); Y.applyUpdate(doc, Uint8Array.from(atob(saved), ch => ch.charCodeAt(0))); documentMap.set(id, doc); } }
  if (!documentMap.has(id)) documentMap.set(id, blocksToYDoc(editor, Array.from({ length: id === rootId ? 26 : 2 }, (_, index) => ({ type: 'paragraph' as const, content: index === 0 ? 'Bản nháp nghiên cứu: phân biệt huấn luyện và suy luận.' : `Đoạn ${index}: Đọc phương pháp, baseline và điều kiện đánh giá trước khi diễn giải kết quả.` })), 'notebook'));
  return documentMap.get(id)!;
};
const projectAccess = () => qa.mode === 'guest' ? 0 : qa.mode === 'viewer' ? 1 : qa.mode === 'editor' ? 3 : 4;
const pageAccess = () => qa.mode === 'viewer' ? 1 : qa.mode === 'guest' ? 3 : projectAccess();
const nativeFetch = window.fetch.bind(window);
const imageStore = new Map<string, { bytes: ArrayBuffer; mime: string; name: string }>();
Object.assign(window, { projectMediaImages: imageStore });
if (parameters.has('media')) { const saved = JSON.parse(sessionStorage.getItem('__media-qa-images') || '[]') as { id: string; bytes: string; mime: string; name: string }[]; saved.forEach(item => imageStore.set(item.id, { ...item, bytes: Uint8Array.from(atob(item.bytes), ch => ch.charCodeAt(0)).buffer })); qa.imageUploads = saved.length; }
const tinyImage = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO1cAAAAASUVORK5CYII='), char => char.charCodeAt(0)).buffer;
if (parameters.has('groups')) { data.project.group_id = 'e'.repeat(32); data.project.visibility = 'group'; }
const conversations = new Map<string, ChatMessage[]>(), schedules = new Map<string, Meeting[]>(), preferences = new Map<string, { muted: boolean; through: number }>(), clientIds = new Map<string, string>();
let sequence = 0;
const conversation = (key: string) => { if (!conversations.has(key)) conversations.set(key, [{ id: crypto.randomUUID().replaceAll('-', ''), seq: ++sequence, body: 'Mình đã đọc paper. Cần phân biệt training rollouts và inference candidates trước khi so sánh benchmark.', author: recipient, parent_id: null, created_at: timestamp, updated_at: timestamp, version: 1, deleted: false, pinned: false, reply_count: 0, context: null }]); return conversations.get(key)!; };
window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin);
  if (!url.pathname.startsWith('/__project-fixture/')) return nativeFetch(input, init);
  const path = url.pathname.replace(/^\/__project-fixture\/api(?:\/collab)?/, ''), method = init?.method || 'GET', body = init?.body instanceof Blob ? {} : JSON.parse(String(init?.body || '{}'));
  qa.requests.push({ path, method, query: url.search, body });
  const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  const mediaPath = /^\/pages\/([a-f0-9]{32})\/images(?:\/(import|[a-f0-9]{32})(\/attach)?)?$/.exec(path);
  if (mediaPath) {
    if (method === 'GET') { const saved = imageStore.get(mediaPath[2]); return saved ? new Response(saved.bytes, { headers: { 'Content-Type': saved.mime } }) : reply({}, 404); }
    if (pageAccess() < 3) return reply({ detail: 'No editing access' }, 404);
    if (mediaPath[3] === '/attach') return imageStore.has(mediaPath[2]) ? reply({ attached: true }) : reply({ detail: 'Image source access required' }, 403);
    if (qa.holdImageUpload) await new Promise(resolve => setTimeout(resolve, 700));
    if (qa.failImageUpload) return reply({ detail: 'notebook_image_invalid' }, 422);
    const id = (++qa.imageUploads).toString(16).padStart(32, '0'), uploaded = init?.body instanceof Blob;
    const headers = new Headers(init?.headers);
    const name = uploaded ? decodeURIComponent(headers.get('X-Image-Name') || 'image.png') : 'public-image.png';
    imageStore.set(id, { bytes: uploaded ? await (init!.body as Blob).arrayBuffer() : tinyImage, mime: 'image/png', name });
    if (parameters.has('media')) sessionStorage.setItem('__media-qa-images', JSON.stringify([...imageStore].map(([id, item]) => ({ ...item, id, bytes: encode(new Uint8Array(item.bytes)) }))));
    return reply({ id, name, width: 1, height: 1, size: imageStore.get(id)!.bytes.byteLength, mime: 'image/png' }, 201);
  }
  if (qa.mode === 'revoked') return reply({ detail: 'Not Found' }, 404);
  const channel = /^\/discussions\/spaces\/(group|project)\/([a-f0-9]{32})(?:\/(messages|preferences|meetings))?$/.exec(path);
  if (channel) {
    const key = `${channel[1]}:${channel[2]}`, access = channel[1] === 'group' ? groupRole === 'member' ? 2 : 4 : projectAccess(), history = conversation(key), preference = preferences.get(key) || { muted: false, through: 0 };
    if (!access) return reply({ detail: 'No access' }, 404);
    if (!channel[3]) return reply({ title: channel[1] === 'group' ? 'AI Lab' : data.project.name, access, can_write: access >= 2, can_rsvp: true, members: [person, recipient], muted: preference.muted, unread_count: history.filter(m => m.seq > preference.through && m.author?.id !== user.id && !m.deleted).length, pinned: history.filter(m => m.pinned && !m.deleted) });
    if (channel[3] === 'preferences') { Object.assign(preference, body); preferences.set(key, preference); return reply({ status: 'saved' }); }
    if (channel[3] === 'messages') {
      if (method === 'POST') {
        if (access < 2) return reply({ detail: 'Read only' }, 403);
        const previous = clientIds.get(`${key}:${body.client_id}`); if (previous) return reply({ message: history.find(m => m.id === previous) }, 201);
        const message: ChatMessage = { id: crypto.randomUUID().replaceAll('-', ''), seq: ++sequence, body: String(body.body), author: person, parent_id: body.parent_id as string || null, created_at: timestamp, updated_at: timestamp, version: 1, deleted: false, pinned: false, reply_count: 0, context: body.context_id ? { kind: String(body.context_kind), id: String(body.context_id), title: data.pages.find(p => p.id === body.context_id)?.title || 'FINER-SQL', href: `#/collab/page/${body.context_id}` } : null };
        history.push(message); clientIds.set(`${key}:${body.client_id}`, message.id); if (message.parent_id) history.find(m => m.id === message.parent_id)!.reply_count++;
        if (qa.failChatAfterSave > 0) { qa.failChatAfterSave--; return reply({ detail: 'Lost acknowledgement' }, 503); }
        return reply({ message }, 201);
      }
      const query = url.searchParams.get('q'), parent = url.searchParams.get('parent_id'), before = Number(url.searchParams.get('before') || Infinity);
      const rows = history.filter(m => m.seq < before && (query ? !m.deleted && m.body.toLocaleLowerCase().includes(query.toLocaleLowerCase()) : m.parent_id === parent));
      const limit = Number(url.searchParams.get('limit') || 40), messages = rows.slice(-limit);
      const known = (url.searchParams.get('include') || '').split(',');
      return reply({ messages, refreshed: history.filter(m => known.includes(m.id) && (!query || !m.deleted && m.body.toLocaleLowerCase().includes(query.toLocaleLowerCase()))), next_cursor: rows.length > limit ? messages[0].seq : null, through: sequence });
    }
    if (channel[3] === 'meetings') {
      const items = schedules.get(key) || []; schedules.set(key, items);
      if (method === 'POST') {
        if (qa.failMeetingSaves > 0) { qa.failMeetingSaves--; return reply({ detail: 'Temporary failure' }, 503); }
        const previous = items.find(m => m.client_id === body.client_id); if (previous) return reply({ meeting: previous }, 201);
        const meeting = { ...body, id: crypto.randomUUID().replaceAll('-', ''), created_by: user.id, status: 'scheduled', version: 1, organizer: person, attendees: [{ person, response: 'yes' }], my_response: 'yes' } as Meeting;
        items.push(meeting); return reply({ meeting }, 201);
      }
      return reply({ meetings: items, next_cursor: null });
    }
  }
  const messageRoute = /^\/discussions\/messages\/([a-f0-9]{32})(?:\/(pin|convert))?$/.exec(path);
  if (messageRoute) {
    const message = [...conversations.values()].flat().find(m => m.id === messageRoute[1]); if (!message) return reply({ detail: 'Not Found' }, 404);
    if (method === 'GET') return reply({ message });
    if (messageRoute[2] === 'pin') { message.pinned = Boolean(body.pinned); return reply({ status: 'saved' }); }
    if (messageRoute[2] === 'convert') { const id = crypto.randomUUID().replaceAll('-', ''); if (body.kind === 'task') data.tasks.push({ id, title: String(body.title), status: 'todo', assignee: null }); else data.pages.push({ id, title: String(body.title), parent_id: null, project_id: projectId, updated_at: timestamp }); return reply({ href: `#/collab/project/${projectId}?view=tasks`, existing: false }); }
    if (body.expected_version !== message.version) return reply({ detail: 'Changed' }, 409);
    if (method === 'DELETE') { message.deleted = true; message.body = ''; message.author = null; message.pinned = false; message.version++; return reply({ status: 'deleted' }); }
    message.body = String(body.body); message.version++; return reply({ message });
  }
  const meetingRoute = /^\/discussions\/meetings\/([a-f0-9]{32})(?:\/(rsvp))?$/.exec(path);
  if (meetingRoute) {
    const item = [...schedules.values()].flat().find(m => m.id === meetingRoute[1]); if (!item) return reply({ detail: 'Not Found' }, 404);
    if (meetingRoute[2]) { item.my_response = body.response as Meeting['my_response']; item.attendees = [{ person, response: item.my_response! }]; return reply({ status: 'saved' }); }
    if (body.expected_version !== item.version) return reply({ detail: 'Changed' }, 409);
    Object.assign(item, body, { version: item.version + 1 }); return reply({ meeting: item });
  }
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
  if (path === '/projects') { if (method === 'POST') { Object.assign(data.project, body, { group_id: url.searchParams.get('group_id'), my_access: 4 }); return reply({ project: data.project }, 201); } return reply({ projects: [data.project] }); }
  const groupDetail = /^\/groups\/([a-f0-9]{32})$/.exec(path);
  if (groupDetail) { const group = groups.find(g => g.id === groupDetail[1]); return group ? reply({ group, projects: data.project.group_id === group.id ? [data.project] : [] }) : reply({ detail: 'Not Found' }, 404); }
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
      if (parameters.has('media')) sessionStorage.setItem('__media-qa-document:' + this.id, encode(Y.encodeStateAsUpdate(seed(this.id))));
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
