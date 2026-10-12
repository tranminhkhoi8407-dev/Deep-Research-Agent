import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Archive, Bell, CheckCheck, ChevronLeft, ChevronRight, MailOpen, Settings2, UserPlus, X } from 'lucide-react';
import type { AuthUser } from './Auth';
import type { Language } from './ProductViews';
import { FriendsPanel, PersonAvatar } from './FriendsPanel';
import { notificationText, relativeTime, roleLabel, safeSocialHref, socialChanged, socialError, socialRequest, type NotificationItem, type NotificationPage } from './social';
import './Social.css';

type SocialContextValue = { open: (panel: 'friends' | 'notifications') => void; unread: number; language: Language; unavailable: boolean };
const SocialContext = createContext<SocialContextValue | null>(null);

export function SocialToolbar() {
  const context = useContext(SocialContext); if (!context) return null;
  const vi = context.language === 'vi';
  return <div className="social-toolbar">
    <button type="button" className="social-toolbar-button" aria-label={vi ? 'Bạn bè · tìm và thêm bạn' : 'Friends · find and add friends'} title={vi ? 'Bạn bè' : 'Friends'} onClick={() => context.open('friends')}><UserPlus size={19} /></button>
    <button type="button" className={`social-toolbar-button${context.unavailable ? ' is-unavailable' : ''}`} aria-label={`${vi ? 'Thông báo' : 'Notifications'} · ${context.unread} ${vi ? 'chưa đọc' : 'unread'}`} title={context.unavailable ? vi ? 'Không thể cập nhật thông báo. Bấm để thử lại.' : 'Notifications unavailable. Click to retry.' : vi ? 'Thông báo' : 'Notifications'} onClick={() => context.open('notifications')}><Bell size={19} />{context.unread > 0 && <span className="social-badge">{context.unread > 99 ? '99+' : context.unread}</span>}</button>
  </div>;
}

export function SocialProvider({ apiBase, user, language, children, onEditProfile }: { apiBase: string; user: AuthUser; language: Language; children: ReactNode; onEditProfile: () => void }) {
  const [panel, setPanel] = useState<'friends' | 'notifications' | null>(null), [unread, setUnread] = useState(0), [unavailable, setUnavailable] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const abort = new AbortController(); let inFlight = false, queued = false;
    const refresh = async () => {
      if (abort.signal.aborted) return;
      if (inFlight) { queued = true; return; }
      inFlight = true;
      try {
        const result = await socialRequest<{ unread_count: number }>(apiBase, '/notifications/count', { signal: abort.signal });
        if (!abort.signal.aborted) { setUnread(result.unread_count); setUnavailable(false); }
      } catch { if (!abort.signal.aborted) setUnavailable(true); }
      finally { inFlight = false; if (queued && !abort.signal.aborted) { queued = false; void refresh(); } }
    };
    const sync = () => { if (document.visibilityState === 'visible') { void refresh(); window.dispatchEvent(new Event('nexora:social-tick')); } };
    void refresh();
    const timer = setInterval(sync, 20_000);
    window.addEventListener('focus', sync); document.addEventListener('visibilitychange', sync); window.addEventListener('nexora:social-changed', sync);
    return () => { abort.abort(); clearInterval(timer); window.removeEventListener('focus', sync); document.removeEventListener('visibilitychange', sync); window.removeEventListener('nexora:social-changed', sync); };
  }, [apiBase, user.id]);
  useEffect(() => {
    if (panel && !dialog.current?.open) dialog.current?.showModal();
    if (!panel && dialog.current?.open) dialog.current?.close();
  }, [panel]);
  const vi = language === 'vi';
  const close = () => setPanel(null);
  return <SocialContext.Provider value={{ open: setPanel, unread, language, unavailable }}>
    {children}
    <dialog ref={dialog} className={`social-dialog ${panel === 'friends' ? 'social-dialog--friends' : ''}`} aria-labelledby="social-dialog-title" onCancel={close} onClose={close} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
    }}>
      <header className="social-dialog-header"><h2 id="social-dialog-title">{panel === 'friends' ? vi ? 'Bạn bè' : 'Friends' : vi ? 'Thông báo' : 'Notifications'}</h2><button type="button" onClick={close} aria-label={vi ? 'Đóng' : 'Close'}><X size={20} /></button></header>
      {panel === 'friends' && <FriendsPanel apiBase={apiBase} language={language} user={user} onEditProfile={() => { close(); onEditProfile(); }} />}
      {panel === 'notifications' && <NotificationsPanel apiBase={apiBase} language={language} onCount={setUnread} onClose={close} onFriends={() => setPanel('friends')} />}
    </dialog>
  </SocialContext.Provider>;
}

function NotificationsPanel({ apiBase, language, onCount, onClose, onFriends }: { apiBase: string; language: Language; onCount: (value: number) => void; onClose: () => void; onFriends: () => void }) {
  const vi = language === 'vi';
  const [unreadOnly, setUnreadOnly] = useState(false), [category, setCategory] = useState(''), [settings, setSettings] = useState(false);
  const [cursors, setCursors] = useState<(number | null)[]>([null]);
  const [data, setData] = useState<NotificationPage | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [preferences, setPreferences] = useState({ friends: true, collaboration: true, tasks: true });
  const [preferencesReady, setPreferencesReady] = useState(false);
  const generation = useRef(0), mutation = useRef(false), scrollArea = useRef<HTMLDivElement>(null);
  const before = cursors[cursors.length - 1];
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    const params = new URLSearchParams({ limit: '30' });
    if (before) params.set('before', String(before));
    if (unreadOnly) params.set('unread', 'true');
    if (category) params.set('category', category);
    const result = await socialRequest<NotificationPage>(apiBase, `/notifications?${params}`);
    if (current !== generation.current) return;
    setData(result); onCount(result.unread_count); setLoading(false);
  }, [apiBase, before, category, unreadOnly, onCount]);
  useEffect(() => {
    setLoading(true);
    const sync = () => { void refresh().catch(reason => { setError(socialError(reason, vi)); setLoading(false); }); };
    sync(); window.addEventListener('nexora:social-tick', sync);
    return () => { generation.current++; window.removeEventListener('nexora:social-tick', sync); };
  }, [refresh, vi]);
  useEffect(() => { scrollArea.current?.scrollTo({ top: 0 }); }, [before, category, unreadOnly]);
  useEffect(() => {
    if (!settings) return;
    setPreferencesReady(false);
    const abort = new AbortController();
    void socialRequest<typeof preferences>(apiBase, '/notifications/preferences', { signal: abort.signal }).then(result => { if (!abort.signal.aborted) { setPreferences(result); setPreferencesReady(true); } }).catch(reason => { if (!abort.signal.aborted) setError(socialError(reason, vi)); });
    return () => abort.abort();
  }, [apiBase, settings, vi]);
  const run = async (work: () => Promise<unknown>, then?: () => void) => {
    if (mutation.current) return;
    mutation.current = true; setBusy(true); setError('');
    try { await work(); await refresh(); socialChanged(); then?.(); }
    catch (reason) { setError(socialError(reason, vi)); await refresh().catch(() => {}); }
    finally { mutation.current = false; setBusy(false); }
  };
  const change = (item: NotificationItem, action: 'read' | 'unread' | 'archive') => void run(() => socialRequest(apiBase, `/notifications/${item.id}`, { method: 'PATCH', body: JSON.stringify({ action }) }));
  const openItem = (item: NotificationItem) => {
    const href = safeSocialHref(item.href); if (!href) return;
    void run(() => socialRequest(apiBase, `/notifications/${item.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'read' }) }), () => {
      if (href === '#/collab/people') onFriends(); else { onClose(); window.location.hash = href; }
    });
  };
  const respond = (item: NotificationItem, action: 'accept' | 'decline') => void run(() => socialRequest(apiBase, `/notifications/${item.id}/respond`, { method: 'POST', body: JSON.stringify({ action }) }));
  const stateLabels: Record<string, [string, string]> = { pending: ['Đang chờ', 'Pending'], accepted: ['Đã chấp nhận', 'Accepted'], declined: ['Đã xử lý', 'Handled'], expired: ['Không còn hiệu lực', 'Expired'], unavailable: ['Không còn khả dụng', 'Unavailable'] };
  return <div className="notifications-panel">
    <div className="social-notification-controls"><div className="social-tabs"><button aria-pressed={!unreadOnly} onClick={() => { setUnreadOnly(false); setCursors([null]); }}>{vi ? 'Tất cả' : 'All'}</button><button aria-pressed={unreadOnly} onClick={() => { setUnreadOnly(true); setCursors([null]); }}>{vi ? 'Chưa đọc' : 'Unread'}<small>{data?.unread_count || 0}</small></button></div><button className="social-icon-button" aria-label={vi ? 'Tùy chọn thông báo' : 'Notification settings'} aria-pressed={settings} onClick={() => setSettings(value => !value)}><Settings2 size={18} /></button></div>
    <div className="social-notification-tools"><select aria-label={vi ? 'Loại thông báo' : 'Notification category'} value={category} onChange={event => { setCategory(event.target.value); setCursors([null]); }}><option value="">{vi ? 'Mọi loại' : 'All categories'}</option><option value="friends">{vi ? 'Bạn bè' : 'Friends'}</option><option value="collaboration">{vi ? 'Cộng tác' : 'Collaboration'}</option><option value="tasks">{vi ? 'Nhiệm vụ' : 'Tasks'}</option></select><button disabled={busy || !data?.unread_count} onClick={() => void run(() => socialRequest(apiBase, '/notifications/read-all', { method: 'POST', body: JSON.stringify({ through: data?.through || 0 }) }))}><CheckCheck size={15} />{vi ? 'Đánh dấu tất cả đã đọc' : 'Mark all read'}</button></div>
    {settings && <section className="social-settings"><strong>{vi ? 'Thông báo trong web' : 'In-app notifications'}</strong><p>{vi ? 'Tắt chỉ ảnh hưởng thông báo mới; lời mời vẫn ở Bạn bè hoặc Lời mời. Không gửi email hay thông báo ngoài trình duyệt.' : 'Muting affects new notifications only. Requests remain in Friends or Invitations. No email or browser push is sent.'}</p>{(['friends', 'collaboration', 'tasks'] as const).map(key => <label key={key}><input type="checkbox" checked={preferences[key]} disabled={busy || !preferencesReady} onChange={event => {
      const next = { ...preferences, [key]: event.target.checked };
      void run(async () => { const saved = await socialRequest<typeof preferences>(apiBase, '/notifications/preferences', { method: 'PUT', body: JSON.stringify(next) }); setPreferences(saved); });
    }} />{key === 'friends' ? vi ? 'Bạn bè' : 'Friends' : key === 'collaboration' ? vi ? 'Lời mời cộng tác' : 'Collaboration invitations' : vi ? 'Nhiệm vụ được giao' : 'Assigned tasks'}</label>)}</section>}
    {error && <div role="alert" className="social-error">{error}<button disabled={busy} onClick={() => void run(async () => {
      if (settings) { const saved = await socialRequest<typeof preferences>(apiBase, '/notifications/preferences'); setPreferences(saved); setPreferencesReady(true); }
    })}>{vi ? 'Thử lại' : 'Retry'}</button></div>}
    <div ref={scrollArea} className="social-notification-list" aria-busy={loading || busy}>
      {loading ? <div className="social-empty" role="status">{vi ? 'Đang tải thông báo…' : 'Loading notifications…'}</div> : !data?.notifications.length ? <div className="social-empty"><Bell size={30} /><h3>{vi ? 'Không có thông báo ở đây' : 'No notifications here'}</h3><p>{vi ? 'Lời mời mới và cập nhật dành cho bạn sẽ xuất hiện tại đây.' : 'New invitations and updates for you will appear here.'}</p></div> : data.notifications.map(item => <article key={item.id} className={`social-notification${item.read_at ? '' : ' is-unread'}`}>
        <PersonAvatar person={item.actor} /><div className="social-notification-body"><strong>{notificationText(item, vi)}</strong><small><time dateTime={item.created_at} title={new Date(item.created_at).toLocaleString(vi ? 'vi-VN' : 'en-US')}>{relativeTime(item.created_at, vi)}</time>{stateLabels[item.state] && ` · ${stateLabels[item.state][vi ? 0 : 1]}`}</small>
          {item.role && <small>{vi ? 'Quyền' : 'Permission'}: {roleLabel(item.role, vi)}</small>}
          <div className="social-notification-actions">
            {item.state === 'pending' && item.action_id && <><button disabled={busy} onClick={() => respond(item, 'accept')}>{vi ? 'Chấp nhận' : 'Accept'}</button><button disabled={busy} onClick={() => respond(item, 'decline')}>{vi ? 'Từ chối' : 'Decline'}</button></>}
            {safeSocialHref(item.href) && <button disabled={busy} onClick={() => openItem(item)}>{vi ? 'Mở' : 'Open'}</button>}
            <button className="social-icon-button" disabled={busy} title={item.read_at ? vi ? 'Đánh dấu chưa đọc' : 'Mark unread' : vi ? 'Đánh dấu đã đọc' : 'Mark read'} aria-label={item.read_at ? vi ? 'Đánh dấu chưa đọc' : 'Mark unread' : vi ? 'Đánh dấu đã đọc' : 'Mark read'} onClick={() => change(item, item.read_at ? 'unread' : 'read')}><MailOpen size={15} /></button>
            <button className="social-icon-button" disabled={busy} title={vi ? 'Lưu trữ thông báo; không hủy lời mời' : 'Archive notification; does not cancel the invitation'} aria-label={vi ? 'Lưu trữ thông báo' : 'Archive notification'} onClick={() => change(item, 'archive')}><Archive size={15} /></button>
          </div>
        </div>{!item.read_at && <span className="social-unread-dot" aria-label={vi ? 'Chưa đọc' : 'Unread'} />}
      </article>)}
    </div>
    <footer className="social-notification-footer"><span>{vi ? 'Đã đọc không có nghĩa là đã chấp nhận lời mời.' : 'Reading an invitation does not accept it.'}</span><div><button disabled={busy || cursors.length === 1} aria-label={vi ? 'Thông báo mới hơn' : 'Newer notifications'} onClick={() => setCursors(value => value.slice(0, -1))}><ChevronLeft size={17} /></button><button disabled={busy || !data?.next_cursor} aria-label={vi ? 'Thông báo cũ hơn' : 'Older notifications'} onClick={() => setCursors(value => [...value, data?.next_cursor || null])}><ChevronRight size={17} /></button></div></footer>
  </div>;
}
