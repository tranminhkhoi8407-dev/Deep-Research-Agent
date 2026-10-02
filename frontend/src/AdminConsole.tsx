import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Archive,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  Cpu,
  Database,
  FileText,
  Gauge,
  HardDrive,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Search,
  Save,
  Settings2,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserCog,
  Users,
  UserX,
  X,
} from 'lucide-react';
import type { AuthUser } from './Auth';
import type { Language, ResearchDepth } from './ProductViews';

type AdminTab = 'overview' | 'users' | 'reports' | 'activity' | 'system';

interface AuditEvent {
  id: number;
  actor_id: string;
  actor_name: string | null;
  actor_email: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  detail: string | null;
  created_at: string;
}

interface AdminOverviewData {
  users: { total: number; active: number; suspended: number; admins: number };
  reports: { total: number; storage_bytes: number };
  active_research_sessions: number;
  system: {
    status: string;
    environment: string;
    llm_provider: string;
    oauth: { google: boolean; github: boolean };
    dev_login: boolean;
  };
  recent_activity: AuditEvent[];
}

interface AdminUser {
  id: string;
  provider: string;
  name: string;
  email: string | null;
  avatar_url: string | null;
  username: string | null;
  role: 'member' | 'admin';
  status: 'active' | 'suspended';
  license_type: 'free' | 'pro' | 'team';
  license_expires_at: string | null;
  created_at: string;
  last_login_at: string;
  login_count: number;
  report_count: number;
  storage_bytes: number;
}

type AdminUserChange = {
  status?: 'active' | 'suspended';
  license_type?: 'free' | 'pro' | 'team';
  license_expires_at?: string | null;
};

interface AdminReport {
  id: string;
  title: string;
  created_at: string;
  size_bytes: number;
  source_count: number;
  research_depth: ResearchDepth;
  owner_id: string;
  owner_name: string;
  owner_email: string | null;
  owner_provider: string;
}

interface AdminConsoleProps {
  apiBase: string;
  language: Language;
  currentUser: AuthUser;
  onNotify: (message: string) => void;
}

const content = {
  vi: {
    eyebrow: 'Host control center',
    title: 'Quản trị Nexora',
    description: 'Quan sát hệ thống, quản lý thành viên và kiểm soát dữ liệu từ một nơi.',
    tabs: { overview: 'Tổng quan', users: 'Thành viên', reports: 'Báo cáo', activity: 'Hoạt động', system: 'Hệ thống' },
    refresh: 'Làm mới', loading: 'Đang tải Host Console…', retry: 'Thử lại',
    loadError: 'Không thể tải dữ liệu quản trị.',
    stats: ['Tổng thành viên', 'Báo cáo', 'Phiên đang chạy', 'Dung lượng'],
    health: 'Sức khỏe hệ thống', recent: 'Hoạt động gần đây', recentHint: 'Các sự kiện đăng nhập và thao tác quản trị mới nhất.',
    usersTitle: 'Quản lý thành viên', usersHint: 'Theo dõi provider, license và hạn dùng; quyền Host luôn được đồng bộ từ ADMIN_EMAILS.',
    searchUsers: 'Tìm username, tên hoặc email…', allStatus: 'Tất cả trạng thái', allProviders: 'Tất cả provider', allLicenses: 'Tất cả license', active: 'Đang hoạt động', suspended: 'Tạm khóa',
    user: 'Thành viên', provider: 'Provider', role: 'Vai trò', status: 'Trạng thái', license: 'License', expires: 'Hết hạn', reports: 'Báo cáo', created: 'Ngày tạo', actions: 'Thao tác',
    admin: 'Host', member: 'Member', suspend: 'Tạm khóa', restore: 'Mở lại', you: 'Bạn',
    manage: 'Quản lý', accountDetails: 'Chi tiết thành viên', save: 'Lưu thay đổi', cancel: 'Hủy', noExpiry: 'Không hết hạn', expired: 'Đã hết hạn',
    licenseHint: 'License điều khiển gói dịch vụ; ngày hết hạn để trống nghĩa là không giới hạn thời gian.',
    reportsTitle: 'Quản lý báo cáo', reportsHint: 'Xem mức sử dụng và xóa report vi phạm hoặc không còn cần thiết.',
    searchReports: 'Tìm report hoặc chủ sở hữu…', report: 'Báo cáo', owner: 'Chủ sở hữu', depth: 'Độ sâu', size: 'Dung lượng',
    activityTitle: 'Nhật ký hoạt động', activityHint: 'Audit trail giúp host biết ai đã làm gì và vào lúc nào.',
    systemTitle: 'Cấu hình vận hành', systemHint: 'Chỉ hiển thị trạng thái; mọi secret luôn được ẩn.',
    runtime: 'Runtime', auth: 'Xác thực', model: 'LLM provider', environment: 'Môi trường', online: 'Đang hoạt động', configured: 'Đã cấu hình', missing: 'Chưa cấu hình',
    noData: 'Không có dữ liệu phù hợp.', deleted: 'Đã xóa báo cáo.', updated: 'Đã cập nhật thành viên.',
  },
  en: {
    eyebrow: 'Host control center',
    title: 'Manage Nexora',
    description: 'Observe the system, manage members, and control workspace data in one place.',
    tabs: { overview: 'Overview', users: 'Members', reports: 'Reports', activity: 'Activity', system: 'System' },
    refresh: 'Refresh', loading: 'Loading Host Console…', retry: 'Try again',
    loadError: 'Could not load administration data.',
    stats: ['Total members', 'Reports', 'Running sessions', 'Storage'],
    health: 'System health', recent: 'Recent activity', recentHint: 'Latest sign-in events and administrative actions.',
    usersTitle: 'Member management', usersHint: 'Track providers, licenses, and expiry; Host access always stays synchronized with ADMIN_EMAILS.',
    searchUsers: 'Search username, name, or email…', allStatus: 'All statuses', allProviders: 'All providers', allLicenses: 'All licenses', active: 'Active', suspended: 'Suspended',
    user: 'Member', provider: 'Provider', role: 'Role', status: 'Status', license: 'License', expires: 'Expires', reports: 'Reports', created: 'Created', actions: 'Actions',
    admin: 'Host', member: 'Member', suspend: 'Suspend', restore: 'Restore', you: 'You',
    manage: 'Manage', accountDetails: 'Member details', save: 'Save changes', cancel: 'Cancel', noExpiry: 'No expiry', expired: 'Expired',
    licenseHint: 'The license controls the service plan; leave expiry empty for unlimited duration.',
    reportsTitle: 'Report management', reportsHint: 'Review usage and remove reports that violate policy or are no longer needed.',
    searchReports: 'Search reports or owners…', report: 'Report', owner: 'Owner', depth: 'Depth', size: 'Size',
    activityTitle: 'Activity log', activityHint: 'An audit trail showing who did what and when.',
    systemTitle: 'Runtime configuration', systemHint: 'Only status is shown; secrets always remain hidden.',
    runtime: 'Runtime', auth: 'Authentication', model: 'LLM provider', environment: 'Environment', online: 'Online', configured: 'Configured', missing: 'Missing',
    noData: 'No matching data.', deleted: 'Report deleted.', updated: 'Member updated.',
  },
} as const;

const tabIcons = { overview: Gauge, users: Users, reports: Archive, activity: Activity, system: Cpu };

export function AdminConsole({ apiBase, language, currentUser, onNotify }: AdminConsoleProps) {
  const t = content[language];
  const [tab, setTab] = useState<AdminTab>('overview');
  const [overview, setOverview] = useState<AdminOverviewData | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [userQuery, setUserQuery] = useState('');
  const [userStatus, setUserStatus] = useState<'all' | 'active' | 'suspended'>('all');
  const [userProvider, setUserProvider] = useState<'all' | string>('all');
  const [userLicense, setUserLicense] = useState<'all' | AdminUser['license_type']>('all');
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [reportQuery, setReportQuery] = useState('');
  const [pendingAction, setPendingAction] = useState('');

  const fetchJson = async <T,>(path: string): Promise<T> => {
    const response = await fetch(`${apiBase}${path}`, { credentials: 'include', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return response.json() as Promise<T>;
  };

  const loadData = async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const [overviewPayload, usersPayload, reportsPayload, auditPayload] = await Promise.all([
        fetchJson<AdminOverviewData>('/api/admin/overview'),
        fetchJson<{ users: AdminUser[] }>('/api/admin/users'),
        fetchJson<{ reports: AdminReport[] }>('/api/admin/reports'),
        fetchJson<{ events: AuditEvent[] }>('/api/admin/audit?limit=100'),
      ]);
      setOverview(overviewPayload);
      setUsers(usersPayload.users);
      setReports(reportsPayload.reports);
      setEvents(auditPayload.events);
    } catch {
      setError(t.loadError);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { void loadData(); }, []);

  const filteredUsers = useMemo(() => {
    const query = userQuery.trim().toLowerCase();
    return users.filter((user) => {
      const matchesQuery = !query || `${user.name} ${user.email || ''} ${user.username || ''}`.toLowerCase().includes(query);
      const matchesStatus = userStatus === 'all' || user.status === userStatus;
      const matchesProvider = userProvider === 'all' || user.provider === userProvider;
      const matchesLicense = userLicense === 'all' || user.license_type === userLicense;
      return matchesQuery && matchesStatus && matchesProvider && matchesLicense;
    });
  }, [users, userQuery, userStatus, userProvider, userLicense]);

  const filteredReports = useMemo(() => {
    const query = reportQuery.trim().toLowerCase();
    return reports.filter((report) => !query || `${report.title} ${report.owner_name} ${report.owner_email || ''}`.toLowerCase().includes(query));
  }, [reports, reportQuery]);

  const updateMember = async (user: AdminUser, change: AdminUserChange, confirmStatus = false): Promise<AdminUser | null> => {
    if (confirmStatus && change.status) {
      const actionLabel = change.status === 'suspended' ? t.suspend : t.restore;
      if (!window.confirm(`${actionLabel} — ${user.name}?`)) return null;
    }
    setPendingAction(user.id);
    try {
      const response = await fetch(`${apiBase}/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { detail?: string };
        throw new Error(payload.detail || 'Update failed');
      }
      const payload = await response.json() as { user: AdminUser };
      setUsers((current) => current.map((item) => item.id === payload.user.id ? payload.user : item));
      setSelectedUser((current) => current?.id === payload.user.id ? payload.user : current);
      onNotify(t.updated);
      await loadData(true);
      return payload.user;
    } catch (reason) {
      onNotify(reason instanceof Error ? reason.message : t.loadError);
      return null;
    } finally {
      setPendingAction('');
    }
  };

  const deleteReport = async (report: AdminReport) => {
    const message = language === 'vi' ? `Xóa vĩnh viễn “${report.title}” của ${report.owner_name}?` : `Permanently delete “${report.title}” owned by ${report.owner_name}?`;
    if (!window.confirm(message)) return;
    setPendingAction(`${report.owner_id}:${report.id}`);
    try {
      const response = await fetch(`${apiBase}/api/admin/reports/${encodeURIComponent(report.owner_id)}/${encodeURIComponent(report.id)}`, { method: 'DELETE', credentials: 'include' });
      if (!response.ok) throw new Error(t.loadError);
      setReports((current) => current.filter((item) => !(item.id === report.id && item.owner_id === report.owner_id)));
      onNotify(t.deleted);
      await loadData(true);
    } catch (reason) {
      onNotify(reason instanceof Error ? reason.message : t.loadError);
    } finally {
      setPendingAction('');
    }
  };

  return (
    <div className="admin-console">
      <header className="admin-hero" data-tour="host-hero">
        <div>
          <span className="eyebrow"><ShieldCheck size={14} />{t.eyebrow}</span>
          <h1>{t.title}</h1>
          <p>{t.description}</p>
        </div>
        <button className="button button--secondary" type="button" disabled={refreshing} onClick={() => void loadData(true)}>
          <RefreshCw className={refreshing ? 'spin' : ''} size={16} />{t.refresh}
        </button>
      </header>

      <nav className="admin-tabs" data-tour="host-tabs" aria-label={language === 'vi' ? 'Điều hướng quản trị' : 'Administration navigation'}>
        {(Object.keys(t.tabs) as AdminTab[]).map((item) => {
          const Icon = tabIcons[item];
          return <button type="button" key={item} className={tab === item ? 'is-active' : ''} aria-label={t.tabs[item]} aria-current={tab === item ? 'page' : undefined} onClick={() => setTab(item)}><Icon size={16} /><span>{t.tabs[item]}</span></button>;
        })}
      </nav>

      {loading ? <AdminLoading label={t.loading} /> : error ? (
        <section className="admin-error"><AlertTriangle size={25} /><h2>{error}</h2><button className="button button--secondary" type="button" onClick={() => void loadData()}><RefreshCw size={16} />{t.retry}</button></section>
      ) : (
        <div className="admin-tab-panel" key={tab}>
          {tab === 'overview' && overview && <OverviewPanel data={overview} language={language} />}
          {tab === 'users' && (
            <section className="admin-section-card">
              <SectionHeading icon={UserCog} title={t.usersTitle} hint={t.usersHint} />
              <div className="admin-toolbar">
                <label className="search-control"><Search size={16} /><input value={userQuery} onChange={(event) => setUserQuery(event.target.value)} placeholder={t.searchUsers} /></label>
                <select aria-label={t.allProviders} value={userProvider} onChange={(event) => setUserProvider(event.target.value)}><option value="all">{t.allProviders}</option>{Array.from(new Set(users.map((user) => user.provider))).map((provider) => <option value={provider} key={provider}>{providerLabel(provider)}</option>)}</select>
                <select value={userStatus} onChange={(event) => setUserStatus(event.target.value as typeof userStatus)}><option value="all">{t.allStatus}</option><option value="active">{t.active}</option><option value="suspended">{t.suspended}</option></select>
                <select aria-label={t.allLicenses} value={userLicense} onChange={(event) => setUserLicense(event.target.value as typeof userLicense)}><option value="all">{t.allLicenses}</option><option value="free">Free</option><option value="pro">Pro</option><option value="team">Team</option></select>
              </div>
              <div className="admin-table-wrap">
                <table className="admin-table" aria-label={t.usersTitle}>
                  <thead><tr><th>{t.user}</th><th>{t.provider}</th><th>{t.role}</th><th>{t.status}</th><th>{t.license}</th><th>{t.expires}</th><th>{t.created}</th><th>{t.actions}</th></tr></thead>
                  <tbody>{filteredUsers.map((user) => <UserRow key={user.id} user={user} currentUser={currentUser} language={language} busy={pendingAction === user.id} onUpdate={updateMember} onManage={setSelectedUser} />)}</tbody>
                </table>
              </div>
              {filteredUsers.length === 0 && <EmptyState label={t.noData} />}
              <footer className="admin-table-footer"><span>{filteredUsers.length} / {users.length} {language === 'vi' ? 'thành viên' : 'members'}</span><span><BadgeCheck size={13} />{language === 'vi' ? 'Quyền Host đồng bộ từ ADMIN_EMAILS' : 'Host access synced from ADMIN_EMAILS'}</span></footer>
            </section>
          )}
          {tab === 'reports' && (
            <section className="admin-section-card">
              <SectionHeading icon={Archive} title={t.reportsTitle} hint={t.reportsHint} />
              <div className="admin-toolbar one"><label className="search-control"><Search size={16} /><input value={reportQuery} onChange={(event) => setReportQuery(event.target.value)} placeholder={t.searchReports} /></label></div>
              <div className="admin-table-wrap">
                <table className="admin-table" aria-label={t.reportsTitle}>
                  <thead><tr><th>{t.report}</th><th>{t.owner}</th><th>{t.depth}</th><th>{t.size}</th><th>{t.created}</th><th>{t.actions}</th></tr></thead>
                  <tbody>{filteredReports.map((report) => (
                    <tr key={`${report.owner_id}:${report.id}`}>
                      <td><div className="admin-primary-cell"><span className={`file-icon depth-${report.research_depth}`}><FileText size={16} /></span><span><strong>{report.title}</strong><small>{report.source_count} {language === 'vi' ? 'nguồn' : 'sources'}</small></span></div></td>
                      <td><span className="owner-cell"><strong>{report.owner_name}</strong><small>{report.owner_email || report.owner_provider}</small></span></td>
                      <td><span className={`depth-pill depth-${report.research_depth}`}>{report.research_depth}</span></td>
                      <td>{formatBytes(report.size_bytes)}</td><td>{formatDate(report.created_at, language)}</td>
                      <td><button className="admin-icon-action is-danger" type="button" disabled={pendingAction === `${report.owner_id}:${report.id}`} aria-label={`${language === 'vi' ? 'Xóa' : 'Delete'} ${report.title}`} onClick={() => void deleteReport(report)}>{pendingAction === `${report.owner_id}:${report.id}` ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              {filteredReports.length === 0 && <EmptyState label={t.noData} />}
            </section>
          )}
          {tab === 'activity' && <ActivityPanel events={events} language={language} title={t.activityTitle} hint={t.activityHint} empty={t.noData} />}
          {tab === 'system' && overview && <SystemPanel data={overview} language={language} />}
        </div>
      )}
      {selectedUser && <MemberDialog user={selectedUser} currentUser={currentUser} language={language} busy={pendingAction === selectedUser.id} onClose={() => setSelectedUser(null)} onSave={async (change) => { const updated = await updateMember(selectedUser, change); if (updated) setSelectedUser(null); }} onStatusChange={(change) => updateMember(selectedUser, change, true)} />}
    </div>
  );
}

function OverviewPanel({ data, language }: { data: AdminOverviewData; language: Language }) {
  const t = content[language];
  const values = [data.users.total, data.reports.total, data.active_research_sessions, formatBytes(data.reports.storage_bytes)];
  const icons = [Users, Archive, Activity, HardDrive];
  return <>
    <section className="admin-stat-grid" data-tour="host-health">{t.stats.map((label, index) => { const Icon = icons[index]; return <article key={label}><span><Icon size={19} /></span><div><strong>{values[index]}</strong><small>{label}</small></div></article>; })}</section>
    <div className="admin-overview-grid">
      <section className="admin-section-card system-summary"><SectionHeading icon={Gauge} title={t.health} hint={t.systemHint} /><div className="health-orbit"><span><CheckCircle2 size={24} /></span><strong>{t.online}</strong><small>{data.system.environment} · {data.system.llm_provider}</small></div><div className="mini-health-grid"><span><i className={data.system.oauth.google ? 'ok' : ''} />Google OAuth</span><span><i className={data.system.oauth.github ? 'ok' : ''} />GitHub OAuth</span><span><i className="ok" />Session cookie</span><span><i className="ok" />SQLite registry</span></div></section>
      <ActivityPanel compact events={data.recent_activity} language={language} title={t.recent} hint={t.recentHint} empty={t.noData} />
    </div>
  </>;
}

function UserRow({ user, currentUser, language, busy, onUpdate, onManage }: { user: AdminUser; currentUser: AuthUser; language: Language; busy: boolean; onUpdate: (user: AdminUser, change: AdminUserChange, confirmStatus?: boolean) => Promise<AdminUser | null>; onManage: (user: AdminUser) => void }) {
  const t = content[language];
  const isYou = user.id === currentUser.id;
  const initials = user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  return <tr className={user.status === 'suspended' ? 'is-muted' : ''}>
    <td><div className="admin-user-cell"><span>{user.avatar_url ? <img src={user.avatar_url} alt="" /> : initials}</span><div><strong>{user.name}{isYou && <em>{t.you}</em>}</strong><small>{user.email || `@${user.username || user.provider}`}</small></div></div></td>
    <td><span className={`provider-badge is-${user.provider}`}>{providerLabel(user.provider)}</span></td>
    <td><span className={`role-badge is-${user.role}`}>{user.role === 'admin' && <ShieldCheck size={13} />}{user.role === 'admin' ? t.admin : t.member}</span></td>
    <td><span className={`account-status is-${user.status}`}>{user.status === 'active' ? <UserCheck size={13} /> : <UserX size={13} />}{user.status === 'active' ? t.active : t.suspended}</span></td>
    <td><span className={`license-badge is-${user.license_type}`}><CreditCard size={12} />{licenseLabel(user.license_type)}</span></td>
    <td><LicenseExpiry value={user.license_expires_at} language={language} /></td>
    <td><span className="date-cell">{formatDate(user.created_at, language)}<small>{user.report_count} {language === 'vi' ? 'báo cáo' : 'reports'} · {formatBytes(user.storage_bytes)}</small></span></td>
    <td><div className="admin-actions"><button className="admin-row-action" type="button" disabled={busy} onClick={() => onManage(user)}><Settings2 size={14} />{t.manage}</button><button className={`admin-row-action ${user.status === 'active' ? 'is-danger' : 'is-success'}`} type="button" disabled={isYou || busy} onClick={() => void onUpdate(user, { status: user.status === 'active' ? 'suspended' : 'active' }, true)}>{busy ? <LoaderCircle className="spin" size={14} /> : user.status === 'active' ? <LockKeyhole size={14} /> : <UserCheck size={14} />}{user.status === 'active' ? t.suspend : t.restore}</button></div></td>
  </tr>;
}

function MemberDialog({ user, currentUser, language, busy, onClose, onSave, onStatusChange }: { user: AdminUser; currentUser: AuthUser; language: Language; busy: boolean; onClose: () => void; onSave: (change: AdminUserChange) => Promise<void>; onStatusChange: (change: AdminUserChange) => Promise<AdminUser | null> }) {
  const t = content[language];
  const [plan, setPlan] = useState<AdminUser['license_type']>(user.license_type);
  const [expires, setExpires] = useState(user.license_expires_at || '');
  const initials = user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const isYou = user.id === currentUser.id;
  const planDescriptions = language === 'vi'
    ? { free: 'Truy cập cơ bản', pro: 'Nghiên cứu chuyên sâu', team: 'Workspace cho đội nhóm' }
    : { free: 'Core access', pro: 'Advanced research', team: 'Team workspace' };

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return <div className="admin-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="member-dialog" role="dialog" aria-modal="true" aria-labelledby="member-dialog-title">
      <header>
        <div className="dialog-user">
          <span>{user.avatar_url ? <img src={user.avatar_url} alt="" /> : initials}</span>
          <div><small>{t.accountDetails}</small><h2 id="member-dialog-title">{user.name}</h2><p>{user.email || `@${user.username || user.provider}`}</p></div>
        </div>
        <button className="dialog-close" type="button" aria-label={t.cancel} onClick={onClose}><X size={18} /></button>
      </header>

      <div className="member-facts">
        <article><span><BadgeCheck size={15} /></span><small>{t.provider}</small><strong>{providerLabel(user.provider)}</strong></article>
        <article><span><ShieldCheck size={15} /></span><small>{t.role}</small><strong>{user.role === 'admin' ? t.admin : t.member}</strong></article>
        <article><span><FileText size={15} /></span><small>{t.reports}</small><strong>{user.report_count} · {formatBytes(user.storage_bytes)}</strong></article>
        <article><span><CalendarDays size={15} /></span><small>{language === 'vi' ? 'Đăng nhập cuối' : 'Last sign-in'}</small><strong>{formatDate(user.last_login_at, language)}</strong></article>
      </div>

      <form onSubmit={(event) => { event.preventDefault(); void onSave({ license_type: plan, license_expires_at: expires || null }); }}>
        <div className="dialog-section-heading"><div><h3>{language === 'vi' ? 'Gói dịch vụ' : 'Service plan'}</h3><p>{t.licenseHint}</p></div><span className={`account-status is-${user.status}`}>{user.status === 'active' ? t.active : t.suspended}</span></div>
        <div className="license-options">
          {(['free', 'pro', 'team'] as const).map((item) => <button key={item} type="button" className={plan === item ? 'is-selected' : ''} aria-pressed={plan === item} onClick={() => setPlan(item)}><span><CreditCard size={17} /></span><strong>{licenseLabel(item)}</strong><small>{planDescriptions[item]}</small>{plan === item && <CheckCircle2 size={16} />}</button>)}
        </div>
        <label className="expiry-field"><span>{t.expires}</span><div><CalendarDays size={16} /><input type="date" value={expires} onChange={(event) => setExpires(event.target.value)} /><button type="button" onClick={() => setExpires('')}>{t.noExpiry}</button></div></label>
        <div className="dialog-account-controls">
          <div><strong>{language === 'vi' ? 'Trạng thái tài khoản' : 'Account status'}</strong><small>{isYou ? (language === 'vi' ? 'Bạn không thể tự khóa tài khoản Host.' : 'You cannot suspend your own Host account.') : (language === 'vi' ? 'Khóa sẽ kết thúc phiên của thành viên ở request tiếp theo.' : 'Suspension ends the member session on their next request.')}</small></div>
          <button className={`admin-row-action ${user.status === 'active' ? 'is-danger' : 'is-success'}`} type="button" disabled={isYou || busy} onClick={() => void onStatusChange({ status: user.status === 'active' ? 'suspended' : 'active' })}>{user.status === 'active' ? <LockKeyhole size={14} /> : <UserCheck size={14} />}{user.status === 'active' ? t.suspend : t.restore}</button>
        </div>
        <footer><button className="button button--secondary" type="button" onClick={onClose}>{t.cancel}</button><button className="button button--primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}{t.save}</button></footer>
      </form>
    </section>
  </div>;
}

function LicenseExpiry({ value, language }: { value: string | null; language: Language }) {
  const t = content[language];
  if (!value) return <span className="license-expiry is-unlimited">—<small>{t.noExpiry}</small></span>;
  const parsed = new Date(`${value}T23:59:59`);
  const expired = !Number.isNaN(parsed.valueOf()) && parsed < new Date();
  return <span className={`license-expiry ${expired ? 'is-expired' : ''}`}>{formatDateOnly(value, language)}{expired && <small>{t.expired}</small>}</span>;
}

function ActivityPanel({ events, language, title, hint, empty, compact = false }: { events: AuditEvent[]; language: Language; title: string; hint: string; empty: string; compact?: boolean }) {
  const actionLabels: Record<string, [string, string]> = {
    'auth.login': ['Đăng nhập', 'Signed in'], 'auth.logout': ['Đăng xuất', 'Signed out'],
    'user.updated': ['Cập nhật thành viên', 'Updated member'], 'report.deleted': ['Xóa báo cáo', 'Deleted report'],
  };
  return <section className={`admin-section-card audit-card ${compact ? 'is-compact' : ''}`}><SectionHeading icon={Activity} title={title} hint={hint} /><div className="audit-list">{events.map((event) => <article key={event.id}><span className={`audit-icon action-${event.action.replace('.', '-')}`}>{event.action.includes('login') ? <KeyRound size={15} /> : event.action.includes('report') ? <FileText size={15} /> : event.action.includes('user') ? <UserCog size={15} /> : <Activity size={15} />}</span><div><strong>{actionLabels[event.action]?.[language === 'vi' ? 0 : 1] || event.action}</strong><small>{event.actor_name || event.actor_email || event.actor_id}{event.target_id ? ` · ${event.target_id}` : ''}</small></div><time>{formatDate(event.created_at, language)}</time></article>)}</div>{events.length === 0 && <EmptyState label={empty} />}</section>;
}

function SystemPanel({ data, language }: { data: AdminOverviewData; language: Language }) {
  const t = content[language];
  const items = [
    { icon: Gauge, label: t.runtime, value: t.online, ok: true, detail: 'FastAPI + React/Vite' },
    { icon: Cpu, label: t.model, value: data.system.llm_provider, ok: data.system.llm_provider !== 'not-configured', detail: language === 'vi' ? 'Tên provider công khai, key được ẩn' : 'Provider name is public; keys are hidden' },
    { icon: ShieldCheck, label: t.auth, value: `${Number(data.system.oauth.google) + Number(data.system.oauth.github)}/2 OAuth`, ok: data.system.oauth.google && data.system.oauth.github, detail: `Google ${data.system.oauth.google ? '✓' : '—'} · GitHub ${data.system.oauth.github ? '✓' : '—'}` },
    { icon: Database, label: t.environment, value: data.system.environment, ok: true, detail: data.system.dev_login ? (language === 'vi' ? 'Đăng nhập local đang bật' : 'Local development login enabled') : (language === 'vi' ? 'Đăng nhập development đã tắt' : 'Development login disabled') },
  ];
  return <section className="admin-section-card"><SectionHeading icon={Cpu} title={t.systemTitle} hint={t.systemHint} /><div className="system-card-grid">{items.map((item) => { const Icon = item.icon; return <article key={item.label}><span><Icon size={20} /></span><div><small>{item.label}</small><strong>{item.value}</strong><p>{item.detail}</p></div><em className={item.ok ? 'is-ok' : ''}>{item.ok ? t.configured : t.missing}</em></article>; })}</div></section>;
}

function SectionHeading({ icon: Icon, title, hint }: { icon: typeof Users; title: string; hint: string }) {
  return <header className="admin-section-heading"><span><Icon size={19} /></span><div><h2>{title}</h2><p>{hint}</p></div></header>;
}

function AdminLoading({ label }: { label: string }) {
  return <div className="admin-loading"><LoaderCircle className="spin" size={24} /><strong>{label}</strong><div>{[1, 2, 3, 4].map((item) => <i key={item} />)}</div></div>;
}

function EmptyState({ label }: { label: string }) {
  return <div className="admin-empty"><Search size={22} /><span>{label}</span></div>;
}

function formatDate(value: string, language: Language) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(language === 'vi' ? 'vi-VN' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatDateOnly(value: string, language: Language) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(language === 'vi' ? 'vi-VN' : 'en-GB', { dateStyle: 'medium' }).format(date);
}

function providerLabel(provider: string) {
  return provider === 'google' ? 'Google' : provider === 'github' ? 'GitHub' : provider === 'local' ? 'Local' : provider;
}

function licenseLabel(license: AdminUser['license_type']) {
  return license === 'free' ? 'Free' : license === 'pro' ? 'Pro' : 'Team';
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
