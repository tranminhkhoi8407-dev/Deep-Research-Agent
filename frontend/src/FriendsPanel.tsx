import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Search, ShieldCheck, UserPlus, Users, X } from 'lucide-react';
import type { AuthUser } from './Auth';
import type { Language } from './ProductViews';
import { relationshipAction, relativeTime, socialChanged, socialError, socialRequest, type BlockedPerson, type Friendship, type PublicPerson } from './social';
import './Social.css';

type FriendsTab = 'friends' | 'received' | 'sent' | 'find' | 'blocked';
type Confirmation = { kind: 'block' | 'unfriend' | 'unblock'; person: PublicPerson; connectionId?: string; createdAt?: string };

export function PersonAvatar({ person }: { person: PublicPerson | null }) {
  return <span className="social-avatar">{person?.avatar_url ? <img src={person.avatar_url} alt="" referrerPolicy="no-referrer" /> : person?.display_name?.slice(0, 1).toUpperCase() || <Users size={18} />}</span>;
}

export function FriendsPanel({ apiBase, language, user, onEditProfile }: { apiBase: string; language: Language; user: AuthUser; onEditProfile?: () => void }) {
  const vi = language === 'vi';
  const [tab, setTab] = useState<FriendsTab>('friends');
  const [connections, setConnections] = useState<Friendship[]>([]), [blocks, setBlocks] = useState<BlockedPerson[]>([]);
  const [query, setQuery] = useState(''), [people, setPeople] = useState<PublicPerson[]>([]), [searching, setSearching] = useState(false), [searchEpoch, setSearchEpoch] = useState(0);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null), [invitePerson, setInvitePerson] = useState<PublicPerson | null>(null);
  const generation = useRef(0), mutation = useRef(false);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    const [friends, blocked] = await Promise.all([
      socialRequest<{ connections: Friendship[] }>(apiBase, '/collab/connections'),
      socialRequest<{ blocks: BlockedPerson[] }>(apiBase, '/collab/blocks'),
    ]);
    if (current !== generation.current) return;
    setConnections(friends.connections); setBlocks(blocked.blocks); setLoading(false);
  }, [apiBase]);
  useEffect(() => {
    if (!user.public_name) { setLoading(false); return; }
    const reload = () => { void refresh().catch(reason => { setError(socialError(reason, vi)); setLoading(false); }); };
    reload(); window.addEventListener('nexora:social-changed', reload); window.addEventListener('nexora:social-tick', reload);
    return () => { generation.current++; window.removeEventListener('nexora:social-changed', reload); window.removeEventListener('nexora:social-tick', reload); };
  }, [refresh, vi, user.public_name]);
  useEffect(() => {
    const abort = new AbortController(); setPeople([]); setSearching(false);
    if (tab !== 'find' || query.trim().length < 2) return;
    setSearching(true);
    const timer = setTimeout(() => {
      void socialRequest<{ people: PublicPerson[] }>(apiBase, `/collab/people?query=${encodeURIComponent(query.trim())}`, { signal: abort.signal })
        .then(result => { if (!abort.signal.aborted) setPeople(result.people); })
        .catch(reason => { if (!abort.signal.aborted) setError(socialError(reason, vi)); })
        .finally(() => { if (!abort.signal.aborted) setSearching(false); });
    }, 300);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [apiBase, query, tab, vi, searchEpoch]);

  const run = async (work: () => Promise<unknown>, message: string) => {
    if (mutation.current) return;
    mutation.current = true; setBusy(true); setError(''); setNotice('');
    try { await work(); setNotice(message); setConfirmation(null); await refresh(); setSearchEpoch(value => value + 1); socialChanged(); }
    catch (reason) { setError(socialError(reason, vi)); await refresh().catch(() => {}); }
    finally { mutation.current = false; setBusy(false); }
  };
  const respond = (item: Friendship, action: 'accept' | 'decline') => void run(
    () => socialRequest(apiBase, `/collab/connections/${item.id}?action=${action}&expected_created_at=${encodeURIComponent(item.created_at)}`, { method: 'PATCH' }),
    action === 'accept' ? vi ? 'Đã kết bạn. Nội dung riêng tư vẫn được giữ riêng.' : 'You are now friends. Private content stays private.' : vi ? 'Đã xử lý lời mời.' : 'Request handled.',
  );
  const cancel = (item: Friendship) => void run(() => socialRequest(apiBase, `/collab/connections/${item.id}?expected_status=pending&expected_created_at=${encodeURIComponent(item.created_at)}`, { method: 'DELETE' }), vi ? 'Đã hủy lời mời.' : 'Request cancelled.');
  const add = (person: PublicPerson) => void run(() => socialRequest(apiBase, '/collab/connections', { method: 'POST', body: JSON.stringify({ username: person.public_name }) }), vi ? 'Đã cập nhật lời mời kết bạn.' : 'Friend request updated.');
  const confirm = () => {
    if (!confirmation) return;
    const { kind, person, connectionId, createdAt } = confirmation;
    void run(() => socialRequest(apiBase, kind === 'unfriend' ? `/collab/connections/${connectionId}?expected_status=accepted&expected_created_at=${encodeURIComponent(createdAt || '')}` : `/collab/people/${encodeURIComponent(person.id)}/block`, { method: kind === 'block' ? 'POST' : 'DELETE' }),
      kind === 'unblock' ? vi ? 'Đã bỏ chặn. Tình bạn không tự khôi phục.' : 'Unblocked. Friendship was not restored.' : vi ? 'Đã cập nhật. Quyền cộng tác hiện có không thay đổi.' : 'Updated. Existing collaboration permissions are unchanged.');
  };
  const friends = connections.filter(item => item.status === 'accepted');
  const received = connections.filter(item => item.status === 'pending' && item.direction === 'incoming');
  const sent = connections.filter(item => item.status === 'pending' && item.direction === 'outgoing');
  const count = { friends: friends.length, received: received.length, sent: sent.length, find: null, blocked: blocks.length };
  const tabs: [FriendsTab, string][] = [['friends', vi ? 'Bạn bè' : 'Friends'], ['received', vi ? 'Lời mời nhận' : 'Received'], ['sent', vi ? 'Đã gửi' : 'Sent'], ['find', vi ? 'Tìm người' : 'Find people'], ['blocked', vi ? 'Đã chặn' : 'Blocked']];

  if (!user.public_name) return <div className="social-empty"><UserPlus size={30} /><h3>{vi ? 'Chọn tên người dùng trước khi kết bạn' : 'Choose your unique username first'}</h3><p>{vi ? 'Tên này giúp bạn bè tìm đúng tài khoản; email không được công khai.' : 'Friends can find your account without exposing your email.'}</p><button onClick={onEditProfile || (() => { window.location.hash = '#/profile'; })}>{vi ? 'Chỉnh sửa hồ sơ' : 'Edit profile'}</button></div>;
  return <section className="friends-panel">
    <p className="social-help"><ShieldCheck size={16} />{vi ? 'Kết bạn không mở quyền xem paper, ghi chú hay dự án riêng.' : 'Friendship never grants access to private papers, notes, or projects.'}</p>
    <nav className="social-tabs" aria-label={vi ? 'Danh sách bạn bè' : 'Friend lists'}>{tabs.map(([id, label]) => <button key={id} type="button" aria-pressed={tab === id} onClick={() => { setTab(id); setError(''); setNotice(''); setConfirmation(null); setInvitePerson(null); }}>{label}{count[id] !== null && <small>{count[id]}</small>}</button>)}</nav>
    {error && <div className="social-error" role="alert">{error}<button onClick={() => void refresh().catch(reason => setError(socialError(reason, vi)))}>{vi ? 'Thử lại' : 'Retry'}</button></div>}
    {notice && <p className="social-notice" role="status">{notice}</p>}
    {confirmation && <div className="social-confirm" role="alert"><strong>{confirmation.kind === 'block' ? vi ? `Chặn ${confirmation.person.display_name}?` : `Block ${confirmation.person.display_name}?` : confirmation.kind === 'unfriend' ? vi ? `Hủy kết bạn với ${confirmation.person.display_name}?` : `Unfriend ${confirmation.person.display_name}?` : vi ? 'Bỏ chặn người này?' : 'Unblock this person?'}</strong><p>{confirmation.kind === 'unblock' ? vi ? 'Không tự kết bạn lại hoặc khôi phục lời mời cũ.' : 'This does not restore friendship or old invitations.' : vi ? 'Không thay đổi quyền trong nhóm, dự án hoặc trang đã chia sẻ. Cần thu hồi quyền riêng nếu bạn muốn ngừng cộng tác.' : 'Existing group, project and page permissions remain. Revoke sharing separately to end collaboration.'}</p><div><button disabled={busy} onClick={confirm}>{vi ? 'Xác nhận' : 'Confirm'}</button><button disabled={busy} onClick={() => setConfirmation(null)}>{vi ? 'Hủy' : 'Cancel'}</button></div></div>}
    {invitePerson && <FriendInvite key={invitePerson.id} apiBase={apiBase} language={language} person={invitePerson} onClose={() => setInvitePerson(null)} />}
    {tab === 'find' && <label className="social-search"><Search size={18} /><input value={query} maxLength={80} onChange={event => { setQuery(event.target.value); setError(''); }} placeholder={vi ? 'Tìm tên người dùng · ít nhất 2 ký tự' : 'Search usernames · at least 2 characters'} aria-label={vi ? 'Tìm tên người dùng' : 'Search usernames'} /></label>}
    <div className="social-list" aria-busy={loading || busy}>
      {loading ? <p role="status">{vi ? 'Đang tải…' : 'Loading…'}</p> : (tab === 'blocked' ? blocks.map(item => <article className="social-person" key={item.person.id}><PersonAvatar person={item.person} /><div><strong>{item.person.display_name}</strong><small>{vi ? 'Bạn đã chặn' : 'Blocked by you'} · {relativeTime(item.created_at, vi)}</small></div><button disabled={busy} onClick={() => setConfirmation({ kind: 'unblock', person: item.person })}>{vi ? 'Bỏ chặn' : 'Unblock'}</button></article>) : (tab === 'find' ? people : (tab === 'friends' ? friends : tab === 'received' ? received : sent).map(item => item.person)).map(person => {
        const item = connections.find(friend => friend.person.id === person.id), action = relationshipAction(item);
        return <article className="social-person" key={person.id}><PersonAvatar person={person} /><div><strong>{person.display_name}</strong><small>{person.public_name}{item && ` · ${relativeTime(item.created_at, vi)}`}</small></div><div className="social-person-actions">
          {action === 'add' && <button disabled={busy} onClick={() => add(person)}><UserPlus size={15} />{vi ? 'Thêm bạn' : 'Add friend'}</button>}
          {action === 'respond' && item && <><button disabled={busy} onClick={() => respond(item, 'accept')}><Check size={15} />{vi ? 'Chấp nhận' : 'Accept'}</button><button disabled={busy} onClick={() => respond(item, 'decline')}>{vi ? 'Từ chối' : 'Decline'}</button></>}
          {action === 'cancel' && item && <><span>{vi ? 'Đã gửi' : 'Sent'}</span><button disabled={busy} onClick={() => cancel(item)}>{vi ? 'Hủy lời mời' : 'Cancel request'}</button></>}
          {action === 'friends' && <><button disabled={busy} onClick={() => { setInvitePerson(person); setConfirmation(null); }}>{vi ? 'Mời cộng tác' : 'Invite'}</button><button disabled={busy} onClick={() => setConfirmation({ kind: 'unfriend', person, connectionId: item!.id, createdAt: item!.created_at })}>{vi ? 'Hủy kết bạn' : 'Unfriend'}</button></>}
          <button className="social-icon-button" disabled={busy} aria-label={vi ? `Chặn ${person.display_name}` : `Block ${person.display_name}`} title={vi ? 'Chặn' : 'Block'} onClick={() => setConfirmation({ kind: 'block', person, connectionId: item?.id })}><ShieldCheck size={16} /></button>
        </div></article>;
      }))}
      {!loading && (tab === 'find' ? !people.length : tab === 'friends' ? !friends.length : tab === 'received' ? !received.length : tab === 'sent' ? !sent.length : !blocks.length) && <div className="social-empty"><Users size={28} /><p>{searching ? vi ? 'Đang tìm…' : 'Searching…' : tab === 'find' ? query.trim().length < 2 ? vi ? 'Tìm bạn bằng tên người dùng duy nhất.' : 'Find friends by their unique username.' : vi ? 'Không tìm thấy người phù hợp.' : 'No matching people found.' : vi ? 'Danh sách này đang trống.' : 'Nothing here yet.'}</p>{tab === 'friends' && <button onClick={() => setTab('find')}>{vi ? 'Tìm và thêm bạn' : 'Find and add friends'}</button>}</div>}
    </div>
  </section>;
}

type ShareTarget = { id: string; name: string; kind: 'group' | 'project' | 'page' };
function FriendInvite({ apiBase, language, person, onClose }: { apiBase: string; language: Language; person: PublicPerson; onClose: () => void }) {
  const vi = language === 'vi';
  const [targets, setTargets] = useState<ShareTarget[]>([]), [target, setTarget] = useState(''), [role, setRole] = useState('viewer');
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    void Promise.all([
      socialRequest<{ groups: { id: string; name: string; my_role: string }[] }>(apiBase, '/collab/groups', { signal: abort.signal }),
      socialRequest<{ projects: { id: string; name: string; my_access: number; status: string }[] }>(apiBase, '/collab/projects', { signal: abort.signal }),
    ]).then(async ([groups, projects]) => {
      const owned = projects.projects.filter(item => item.my_access >= 4 && item.status !== 'archived');
      const pages = await Promise.all(owned.map(item => socialRequest<{ pages: { id: string; title: string }[] }>(apiBase, `/collab/projects/${item.id}`, { signal: abort.signal }).then(detail => detail.pages.map(page => ({ id: page.id, name: `${item.name} / ${page.title}`, kind: 'page' as const })))));
      if (!abort.signal.aborted) setTargets([...groups.groups.filter(item => ['owner', 'admin'].includes(item.my_role)).map(item => ({ id: item.id, name: item.name, kind: 'group' as const })), ...owned.map(item => ({ id: item.id, name: item.name, kind: 'project' as const })), ...pages.flat()]);
    }).catch(reason => { if (!abort.signal.aborted) setError(socialError(reason, vi)); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [apiBase, vi]);
  const selected = targets.find(item => `${item.kind}:${item.id}` === target);
  return <form className="social-invite-form" onSubmit={event => {
    event.preventDefault(); if (!selected || busy) return; setBusy(true); setError('');
    void socialRequest(apiBase, `/collab/${selected.kind}s/${selected.id}/invites`, { method: 'POST', body: JSON.stringify({ username: person.public_name, role: selected.kind === 'group' ? 'member' : role }) })
      .then(() => { setNotice(vi ? 'Đã gửi lời mời. Người nhận cần chấp nhận trước khi có quyền truy cập.' : 'Invitation sent. Access is granted only after acceptance.'); socialChanged(); })
      .catch(reason => setError(socialError(reason, vi))).finally(() => setBusy(false));
  }}><header><strong>{vi ? 'Mời cộng tác' : 'Invite to collaborate'} · {person.display_name}</strong><button type="button" disabled={busy} onClick={onClose} aria-label={vi ? 'Đóng lời mời' : 'Close invitation'}><X size={17} /></button></header>
    <label>{vi ? 'Nhóm, dự án hoặc trang bạn có quyền chia sẻ' : 'A group, project or page you can share'}<select value={target} onChange={event => { setTarget(event.target.value); setNotice(''); }} disabled={busy || loading}><option value="">{loading ? vi ? 'Đang tải…' : 'Loading…' : vi ? 'Chọn nơi cộng tác' : 'Choose a workspace'}</option>{targets.map(item => <option key={`${item.kind}:${item.id}`} value={`${item.kind}:${item.id}`}>{item.kind === 'group' ? vi ? 'Nhóm' : 'Group' : item.kind === 'project' ? vi ? 'Dự án' : 'Project' : vi ? 'Trang' : 'Page'} · {item.name}</option>)}</select></label>
    {selected && selected.kind !== 'group' && <label>{vi ? 'Quyền được mời' : 'Permission'}<select value={role} disabled={busy} onChange={event => setRole(event.target.value)}><option value="viewer">{vi ? 'Có thể xem' : 'Can view'}</option><option value="commenter">{vi ? 'Có thể bình luận' : 'Can comment'}</option><option value="editor">{vi ? 'Có thể chỉnh sửa' : 'Can edit'}</option></select></label>}
    {!loading && !targets.length && <p>{vi ? 'Chưa có nội dung bạn được quyền mời người khác vào.' : 'You do not have a workspace you can share yet.'}</p>}
    {error && <p className="social-error" role="alert">{error}</p>}{notice && <p className="social-notice" role="status">{notice}</p>}
    <button type="submit" disabled={busy || !selected || !!notice}>{vi ? 'Gửi lời mời' : 'Send invitation'}</button>
  </form>;
}
