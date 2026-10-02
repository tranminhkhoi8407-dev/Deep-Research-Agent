import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowRight,
  Award,
  BadgeCheck,
  BookOpenCheck,
  Building2,
  CalendarDays,
  Check,
  CircleUserRound,
  Clock3,
  Crown,
  ExternalLink,
  FileText,
  Flame,
  Globe2,
  GraduationCap,
  Layers3,
  Link2,
  LoaderCircle,
  MapPin,
  Pencil,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  Target,
  X,
} from 'lucide-react';
import { displayName, type AuthUser } from './Auth';
import type { AppView, Language, StoredReportSummary } from './ProductViews';

interface UserProfileProps {
  apiBase: string;
  language: Language;
  user: AuthUser;
  reports: StoredReportSummary[];
  nameRequired?: boolean;
  editRequest?: number;
  onNavigate: (view: AppView) => void;
  onOpenReport: (report: StoredReportSummary) => void;
  onUserUpdate: (user: AuthUser) => void;
  onNotify: (message: string) => void;
}

interface ProfileDraft {
  public_name: string;
  bio: string;
  location: string;
  organization: string;
  website: string;
  interests: string;
}

const domainNames: Record<string, { vi: string; en: string }> = {
  general: { vi: 'Đa lĩnh vực', en: 'General research' },
  mathematics: { vi: 'Toán học', en: 'Mathematics' },
  physics: { vi: 'Vật lý', en: 'Physics' },
  chemistry: { vi: 'Hóa học', en: 'Chemistry' },
  biology: { vi: 'Sinh học', en: 'Biology' },
  'computer-science-ai': { vi: 'Khoa học máy tính & AI', en: 'Computer science & AI' },
  ai: { vi: 'Trí tuệ nhân tạo', en: 'Artificial intelligence' },
};

const copy = {
  vi: {
    eyebrow: 'HỒ SƠ NGHIÊN CỨU CÁ NHÂN', title: 'Không gian của bạn, tiến độ của bạn.',
    description: 'Theo dõi dấu ấn nghiên cứu, lĩnh vực chuyên sâu và những báo cáo đã tạo trong một hồ sơ thống nhất.',
    edit: 'Chỉnh sửa hồ sơ', member: 'Thành viên', host: 'Host', joined: 'Tham gia', logins: 'lần đăng nhập',
    about: 'Giới thiệu', noBio: 'Thêm vài dòng về hướng nghiên cứu và mục tiêu của bạn.',
    interests: 'Mối quan tâm', noInterests: 'Chưa thêm lĩnh vực quan tâm.',
    account: 'Tài khoản & quyền truy cập', provider: 'Nhà cung cấp', plan: 'Gói hiện tại', status: 'Trạng thái', active: 'Đang hoạt động',
    stats: ['Báo cáo', 'Nguồn duy nhất', 'Phiên chuyên sâu', 'Nguồn chất lượng cao'],
    activity: 'Nhịp nghiên cứu', activityHint: 'Hoạt động tạo báo cáo trong 12 tháng gần nhất.', activeDays: 'ngày hoạt động', streak: 'chuỗi dài nhất', less: 'Ít', more: 'Nhiều',
    achievements: 'Cột mốc nghiên cứu', achievementsHint: 'Tự động mở khóa từ hoạt động thật trong workspace.', unlocked: 'Đã mở khóa', locked: 'Chưa đạt',
    specialties: 'Bản đồ chuyên môn', specialtiesHint: 'Phân bố báo cáo theo lĩnh vực bạn đã nghiên cứu.', noSpecialties: 'Hoàn thành một báo cáo có lĩnh vực để bắt đầu bản đồ chuyên môn.',
    guide: 'Tiến độ Guide', guideHint: 'Các bài đã đánh dấu hoàn thành trong cẩm nang.', lessons: 'bài', continueGuide: 'Tiếp tục học',
    recent: 'Báo cáo gần đây', recentHint: 'Tiếp tục từ công việc gần nhất của bạn.', viewLibrary: 'Xem toàn bộ thư viện', noReports: 'Chưa có báo cáo. Hãy bắt đầu brief đầu tiên để xây hồ sơ nghiên cứu.', start: 'Bắt đầu nghiên cứu', sources: 'nguồn',
    editTitle: 'Cá nhân hóa hồ sơ', editHint: 'Thông tin này được lưu với tài khoản. Email và avatar vẫn do nhà cung cấp đăng nhập quản lý.',
    name: 'Tên người dùng', required: 'Bắt buộc', nameHelp: 'Tên trên hồ sơ Nexora, dùng để tìm bạn bè và gửi lời mời. Phải duy nhất, 3–30 ký tự; chữ, số, dấu cách, dấu gạch ngang hoặc gạch dưới. Không có dấu @.', nameInvalid: 'Nhập tên từ 3–30 ký tự, bắt đầu và kết thúc bằng chữ hoặc số (hoặc gạch dưới). Không dùng @ hay ký tự đặc biệt.', nameTaken: 'Tên này đã có người đặt rồi. Vui lòng nhập tên khác.', nameMissing: 'Vui lòng nhập tên người dùng vào hồ sơ trước khi tiếp tục.', setupTitle: 'Đặt tên trong hồ sơ để mở Notebook & Dự án', setupHint: 'Lưu tên duy nhất tại Chỉnh sửa hồ sơ. Các thông tin khác không bắt buộc. Sau khi lưu, bạn sẽ quay lại nơi vừa định mở.', setupSave: 'Lưu hồ sơ & tiếp tục', updateError: 'Không lưu được hồ sơ. Vui lòng thử lại.', bio: 'Giới thiệu ngắn', location: 'Địa điểm', organization: 'Trường / tổ chức', website: 'Website', interestInput: 'Lĩnh vực quan tâm',
    interestHelp: 'Phân tách bằng dấu phẩy, tối đa 8 mục.', cancel: 'Hủy', save: 'Lưu thay đổi', saving: 'Đang lưu…', saved: 'Đã cập nhật hồ sơ.',
    websiteError: 'Website phải bắt đầu bằng http:// hoặc https://', completion: 'Độ hoàn thiện hồ sơ',
  },
  en: {
    eyebrow: 'PERSONAL RESEARCH PROFILE', title: 'Your space, your research momentum.',
    description: 'See your research footprint, strongest fields, and completed reports in one personalized profile.',
    edit: 'Edit profile', member: 'Member', host: 'Host', joined: 'Joined', logins: 'sign-ins',
    about: 'About', noBio: 'Add a short note about your research direction and goals.',
    interests: 'Research interests', noInterests: 'No research interests added yet.',
    account: 'Account & access', provider: 'Provider', plan: 'Current plan', status: 'Status', active: 'Active',
    stats: ['Reports', 'Unique sources', 'Deep sessions', 'High-quality sources'],
    activity: 'Research activity', activityHint: 'Report creation activity over the last 12 months.', activeDays: 'active days', streak: 'longest streak', less: 'Less', more: 'More',
    achievements: 'Research milestones', achievementsHint: 'Unlocked automatically from real workspace activity.', unlocked: 'Unlocked', locked: 'Not yet',
    specialties: 'Expertise map', specialtiesHint: 'Distribution of reports across your research fields.', noSpecialties: 'Complete a field-based report to begin your expertise map.',
    guide: 'Guide progress', guideHint: 'Lessons marked complete in the product guide.', lessons: 'lessons', continueGuide: 'Continue guide',
    recent: 'Recent reports', recentHint: 'Continue from your latest research work.', viewLibrary: 'View full library', noReports: 'No reports yet. Start your first brief to build your research profile.', start: 'Start research', sources: 'sources',
    editTitle: 'Personalize your profile', editHint: 'These details are stored with your account. Email and avatar stay managed by your sign-in provider.',
    name: 'Username', required: 'Required', nameHelp: 'Your Nexora profile name, used to find friends and send invitations. Must be unique, 3–30 letters, numbers, spaces, hyphens or underscores. No @ symbol.', nameInvalid: 'Use 3–30 characters, starting and ending with a letter, number or underscore. No @ or special symbols.', nameTaken: 'This name is already taken. Please enter a different name.', nameMissing: 'Please set your username in your profile before continuing.', setupTitle: 'Set your profile name to open Notebook & Projects', setupHint: 'Save a unique name in Edit profile. All other details are optional. After saving, you will return to the place you wanted to open.', setupSave: 'Save profile & continue', updateError: 'Could not save your profile. Please try again.', bio: 'Short bio', location: 'Location', organization: 'School / organization', website: 'Website', interestInput: 'Research interests',
    interestHelp: 'Separate with commas, up to 8 items.', cancel: 'Cancel', save: 'Save changes', saving: 'Saving…', saved: 'Profile updated.',
    websiteError: 'Website must start with http:// or https://', completion: 'Profile completeness',
  },
} as const;

function formatDate(value: string | undefined, language: Language, withYear = true) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(language === 'vi' ? 'vi-VN' : 'en-US', {
    day: '2-digit', month: 'short', ...(withYear ? { year: 'numeric' as const } : {}),
  }).format(date);
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  return `${year}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function loadGuideCount() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem('deep-research-guide-progress') || '[]');
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function longestStreak(keys: string[]) {
  const days = [...new Set(keys)].map((key) => new Date(`${key}T12:00:00`).getTime()).sort((a, b) => a - b);
  let best = days.length ? 1 : 0;
  let current = best;
  for (let index = 1; index < days.length; index += 1) {
    if (Math.round((days[index] - days[index - 1]) / 86_400_000) === 1) current += 1;
    else current = 1;
    best = Math.max(best, current);
  }
  return best;
}

function profileDraft(user: AuthUser): ProfileDraft {
  return {
    // Existing, explicitly edited display names can be confirmed here. Never
    // auto-reserve a provider's name, email or generated default on their behalf.
    public_name: user.public_name || user.display_name || '',
    bio: user.bio || '', location: user.location || '', organization: user.organization || '',
    website: user.website || '', interests: (user.research_interests || []).join(', '),
  };
}

export function UserProfile({ apiBase, language, user, reports, nameRequired = false, editRequest = 0, onNavigate, onOpenReport, onUserUpdate, onNotify }: UserProfileProps) {
  const t = copy[language];
  const name = displayName(user);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [editing, setEditing] = useState(nameRequired || editRequest > 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [nameError, setNameError] = useState('');
  const [draft, setDraft] = useState<ProfileDraft>(() => profileDraft(user));
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!nameRequired && !editRequest) return;
    setDraft(profileDraft(user));
    setError('');
    setNameError('');
    setEditing(true);
  }, [nameRequired, editRequest]);

  useEffect(() => {
    if (!editing || !dialogRef.current) return;
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    dialog.showModal();
    nameRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [editing]);
  const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const guideCount = loadGuideCount();

  const metrics = useMemo(() => {
    const sources = new Map<string, StoredReportSummary['sources'][number]>();
    reports.forEach((report) => report.sources.forEach((source) => sources.set(source.url.replace(/\/$/, ''), source)));
    const highSources = [...sources.values()].filter((source) => source.quality === 'high').length;
    return [reports.length, sources.size, reports.filter((report) => report.research_depth === 'deep').length, highSources];
  }, [reports]);

  const activity = useMemo(() => {
    const counts = new Map<string, number>();
    reports.forEach((report) => {
      const parsed = new Date(report.created_at);
      if (!Number.isNaN(parsed.getTime())) counts.set(dateKey(parsed), (counts.get(dateKey(parsed)) || 0) + 1);
    });
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 363);
    const days = Array.from({ length: 364 }, (_, index) => {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
      const count = counts.get(dateKey(date)) || 0;
      return { key: dateKey(date), date, count, level: count === 0 ? 0 : Math.min(4, count) };
    });
    const activeKeys = [...counts.keys()];
    return { days, activeDays: days.filter((day) => day.count > 0).length, streak: longestStreak(activeKeys) };
  }, [reports]);

  const domainStats = useMemo(() => {
    const counts = new Map<string, number>();
    reports.forEach((report) => {
      const key = report.research_domain || 'general';
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [reports]);

  const achievements = [
    { icon: FileText, title: language === 'vi' ? 'Bản thảo đầu tiên' : 'First draft', note: language === 'vi' ? 'Hoàn thành báo cáo đầu tiên' : 'Complete your first report', unlocked: reports.length >= 1 },
    { icon: SearchCheck, title: language === 'vi' ? 'Evidence scout' : 'Evidence scout', note: language === 'vi' ? 'Sử dụng ít nhất 5 nguồn riêng' : 'Use at least 5 unique sources', unlocked: metrics[1] >= 5 },
    { icon: Sparkles, title: language === 'vi' ? 'Deep diver' : 'Deep diver', note: language === 'vi' ? 'Hoàn thành phiên chuyên sâu' : 'Complete a deep session', unlocked: metrics[2] >= 1 },
    { icon: Layers3, title: language === 'vi' ? 'Liên ngành' : 'Cross-disciplinary', note: language === 'vi' ? 'Nghiên cứu từ 2 lĩnh vực' : 'Research across 2 fields', unlocked: domainStats.length >= 2 },
    { icon: GraduationCap, title: language === 'vi' ? 'Guide explorer' : 'Guide explorer', note: language === 'vi' ? 'Hoàn thành 3 bài hướng dẫn' : 'Complete 3 guide lessons', unlocked: guideCount >= 3 },
    { icon: Crown, title: language === 'vi' ? 'Research Pro' : 'Research Pro', note: language === 'vi' ? 'Kích hoạt gói Pro hoặc Team' : 'Activate Pro or Team', unlocked: user.license_type !== 'free' },
  ];

  const profileFields = [user.public_name, user.bio, user.location, user.organization, user.website, (user.research_interests || []).length ? 'interests' : ''];
  const completeness = Math.round((profileFields.filter(Boolean).length / profileFields.length) * 100);
  const recentReports = [...reports].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 6);

  const openEditor = () => {
    setDraft(profileDraft(user));
    setError('');
    setNameError('');
    setEditing(true);
  };

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const publicName = draft.public_name.normalize('NFKC').trim().replace(/\s+/g, ' ');
    if (!/^[\p{L}\p{N}_](?:[\p{L}\p{N}_ -]{1,28}[\p{L}\p{N}_])$/u.test(publicName)) {
      setNameError(publicName ? t.nameInvalid : t.nameMissing);
      nameRef.current?.focus();
      return;
    }
    const website = draft.website.trim();
    if (website && !/^https?:\/\//i.test(website)) {
      setError(t.websiteError);
      return;
    }
    setSaving(true);
    setError('');
    setNameError('');
    try {
      const response = await fetch(`${apiBase}/api/auth/profile`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          public_name: publicName,
          display_name: publicName,
          bio: draft.bio,
          location: draft.location,
          organization: draft.organization,
          website,
          research_interests: draft.interests.split(',').map((item) => item.trim()).filter(Boolean).slice(0, 8),
        }),
      });
      const payload = await response.json() as { user?: AuthUser; detail?: string | { code?: string; message?: string } };
      if (!response.ok || !payload.user) {
        const code = typeof payload.detail === 'object' ? payload.detail?.code : undefined;
        if (code === 'profile_name_taken' || code === 'invalid_profile_name') {
          setNameError(code === 'profile_name_taken' ? t.nameTaken : t.nameInvalid);
          window.requestAnimationFrame(() => nameRef.current?.focus());
          return;
        }
        throw new Error(typeof payload.detail === 'string' ? payload.detail : t.updateError);
      }
      setEditing(false);
      onNotify(t.saved);
      onUserUpdate(payload.user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.updateError);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="profile-page">
      <section className="profile-hero" data-tour="profile-hero">
        <div><span>{t.eyebrow}</span><h1>{t.title}</h1><p>{t.description}</p></div>
        <button className="button button--primary" type="button" onClick={openEditor}><Pencil size={17} />{t.edit}</button>
      </section>

      {(nameRequired || !user.public_name) && <section className="profile-setup-notice" aria-labelledby="profile-setup-title">
        <CircleUserRound size={24} aria-hidden="true" /><div><h2 id="profile-setup-title">{t.setupTitle}</h2><p>{nameRequired ? t.setupHint : t.nameMissing}</p></div>
        <button className="button button--primary" type="button" onClick={openEditor}><Pencil size={16} />{t.edit}</button>
      </section>}

      <div className="profile-layout">
        <aside className="profile-sidebar">
          <section className="profile-identity-card">
            <div className="profile-avatar">
              {user.avatar_url && !avatarFailed ? <img src={user.avatar_url} alt="" onError={() => setAvatarFailed(true)} /> : initials}
              <span title={t.active}><Check size={14} /></span>
            </div>
            <h2>{name}</h2>
            <p>{user.email}</p>
            <div className="profile-role-row"><span><ShieldCheck size={14} />{user.role === 'admin' ? t.host : t.member}</span><span>{user.license_type.toUpperCase()}</span></div>
            <button className="button button--secondary" type="button" onClick={openEditor}><Pencil size={16} />{t.edit}</button>
            <div className="profile-completeness"><span><strong>{t.completion}</strong><small>{completeness}%</small></span><div><i style={{ width: `${completeness}%` }} /></div></div>
          </section>

          <section className="profile-side-section">
            <h3>{t.about}</h3>
            <p className={user.bio ? '' : 'is-muted'}>{user.bio || t.noBio}</p>
            <ul className="profile-facts">
              {user.location && <li><MapPin size={16} /><span>{user.location}</span></li>}
              {user.organization && <li><Building2 size={16} /><span>{user.organization}</span></li>}
              {user.website && <li><Globe2 size={16} /><a href={user.website} target="_blank" rel="noreferrer">{user.website.replace(/^https?:\/\//, '')}<ExternalLink size={13} /></a></li>}
              <li><CalendarDays size={16} /><span>{t.joined} {formatDate(user.created_at, language)}</span></li>
              <li><CircleUserRound size={16} /><span>{user.login_count || 1} {t.logins}</span></li>
            </ul>
          </section>

          <section className="profile-side-section">
            <h3>{t.interests}</h3>
            {(user.research_interests || []).length ? <div className="profile-tags">{user.research_interests?.map((interest) => <span key={interest}>{interest}</span>)}</div> : <p className="is-muted">{t.noInterests}</p>}
          </section>

          <section className="profile-account-card">
            <div><ShieldCheck size={18} /><h3>{t.account}</h3></div>
            <dl><div><dt>{t.provider}</dt><dd>{user.provider}</dd></div><div><dt>{t.plan}</dt><dd>{user.license_type}</dd></div><div><dt>{t.status}</dt><dd className="is-active"><i />{t.active}</dd></div></dl>
          </section>
        </aside>

        <div className="profile-main">
          <section className="profile-stat-grid">
            {t.stats.map((label, index) => {
              const Icon = [FileText, Link2, Target, BadgeCheck][index];
              return <article key={label}><span><Icon size={21} /></span><div><strong>{metrics[index]}</strong><small>{label}</small></div></article>;
            })}
          </section>

          <section className="profile-panel profile-activity-panel">
            <header><div><h2><Flame size={20} />{t.activity}</h2><p>{t.activityHint}</p></div><div className="profile-activity-summary"><span><strong>{activity.activeDays}</strong>{t.activeDays}</span><span><strong>{activity.streak}</strong>{t.streak}</span></div></header>
            <div className="profile-heatmap-scroll">
              <div className="profile-heatmap" aria-label={t.activity}>
                {activity.days.map((day) => <i key={day.key} className={`level-${day.level}`} title={`${formatDate(day.key, language)} · ${day.count} ${t.stats[0].toLowerCase()}`} />)}
              </div>
            </div>
            <footer><span>{formatDate(activity.days[0].key, language, false)}</span><div><small>{t.less}</small>{[0, 1, 2, 3, 4].map((level) => <i className={`level-${level}`} key={level} />)}<small>{t.more}</small></div><span>{formatDate(activity.days[activity.days.length - 1]?.key, language, false)}</span></footer>
          </section>

          <div className="profile-two-column">
            <section className="profile-panel profile-achievements">
              <header><div><h2><Award size={20} />{t.achievements}</h2><p>{t.achievementsHint}</p></div><strong>{achievements.filter((item) => item.unlocked).length}/{achievements.length}</strong></header>
              <div>{achievements.map((achievement) => { const Icon = achievement.icon; return <article className={achievement.unlocked ? 'is-unlocked' : ''} key={achievement.title}><span><Icon size={20} /></span><div><strong>{achievement.title}</strong><small>{achievement.note}</small></div><em>{achievement.unlocked ? t.unlocked : t.locked}</em></article>; })}</div>
            </section>

            <div className="profile-stack">
              <section className="profile-panel profile-specialties">
                <header><div><h2><Layers3 size={20} />{t.specialties}</h2><p>{t.specialtiesHint}</p></div></header>
                {domainStats.length ? <div>{domainStats.map(([domain, count]) => <article key={domain}><span><strong>{domainNames[domain]?.[language] || domain.replace(/-/g, ' ')}</strong><small>{count} {t.stats[0].toLowerCase()}</small></span><div><i style={{ width: `${Math.round((count / Math.max(1, reports.length)) * 100)}%` }} /></div></article>)}</div> : <p className="profile-empty-copy">{t.noSpecialties}</p>}
              </section>
              <section className="profile-panel profile-guide-progress">
                <header><div><h2><BookOpenCheck size={20} />{t.guide}</h2><p>{t.guideHint}</p></div><strong>{guideCount}/15</strong></header>
                <div><i style={{ width: `${Math.round((guideCount / 15) * 100)}%` }} /></div>
                <button type="button" onClick={() => onNavigate('guide')}>{t.continueGuide}<ArrowRight size={16} /></button>
              </section>
            </div>
          </div>

          <section className="profile-panel profile-recent">
            <header><div><h2><Clock3 size={20} />{t.recent}</h2><p>{t.recentHint}</p></div>{reports.length > 0 && <button type="button" onClick={() => onNavigate('reports')}>{t.viewLibrary}<ArrowRight size={16} /></button>}</header>
            {recentReports.length ? <div className="profile-report-list">{recentReports.map((report) => <button type="button" key={report.id} onClick={() => onOpenReport(report)}><span className={`depth-dot is-${report.research_depth}`} /><div><strong>{report.title}</strong><small>{formatDate(report.created_at, language)} · {report.source_count} {t.sources} · {formatBytes(report.size_bytes)}</small></div><ArrowRight size={17} /></button>)}</div> : <div className="profile-empty-state"><FileText size={31} /><p>{t.noReports}</p><button className="button button--primary" type="button" onClick={() => onNavigate('research')}><Sparkles size={16} />{t.start}</button></div>}
          </section>
        </div>
      </div>

      {editing && createPortal((
          <dialog ref={dialogRef} className="profile-dialog" aria-labelledby="profile-dialog-title" aria-describedby="profile-dialog-description" onCancel={(event) => { event.preventDefault(); if (!saving) setEditing(false); }} onKeyDown={(event) => {
            if (event.key !== 'Tab') return;
            const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button,input,textarea,select,a[href],[tabindex]'))
              .filter((element) => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length);
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (!first || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
              event.preventDefault();
              (event.shiftKey ? last : first)?.focus();
            }
          }} onMouseDown={(event) => {
            if (event.currentTarget !== event.target || saving) return;
            const rect = event.currentTarget.getBoundingClientRect();
            if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) setEditing(false);
          }}>
            <header><div><span><Pencil size={19} /></span><div><h2 id="profile-dialog-title">{t.editTitle}</h2><p id="profile-dialog-description">{nameRequired ? t.setupHint : t.editHint}</p></div></div><button type="button" disabled={saving} aria-label={t.cancel} onClick={() => setEditing(false)}><X size={19} /></button></header>
            <form onSubmit={(event) => void saveProfile(event)}>
              <fieldset className="profile-form-grid" disabled={saving}>
                <label className="profile-form-wide profile-name-field">
                  <span>{t.name} <em>{t.required}</em></span>
                  <input ref={nameRef} id="profile-username" name="username" aria-label={t.name}
                    autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={3} maxLength={30}
                    value={draft.public_name} placeholder={language === 'vi' ? 'Nhập tên của bạn trên Nexora' : 'Choose your name on Nexora'}
                    aria-invalid={Boolean(nameError)} aria-describedby={`profile-name-help${nameError ? ' profile-name-error' : ''}`}
                    onInvalid={(event) => { event.preventDefault(); setNameError(draft.public_name.trim() ? t.nameInvalid : t.nameMissing); nameRef.current?.focus(); }}
                    onChange={(event) => { setDraft({ ...draft, public_name: event.target.value }); setNameError(''); }} />
                  <small id="profile-name-help">{t.nameHelp}</small>
                  {nameError && <strong id="profile-name-error" className="profile-name-error" role="alert">{nameError}</strong>}
                </label>
                <label><span>{t.location}</span><input maxLength={80} value={draft.location} placeholder="Ho Chi Minh City" onChange={(event) => setDraft({ ...draft, location: event.target.value })} /></label>
                <label><span>{t.organization}</span><input maxLength={120} value={draft.organization} placeholder="University / Lab / Company" onChange={(event) => setDraft({ ...draft, organization: event.target.value })} /></label>
                <label className="profile-form-wide"><span>{t.website}</span><input type="url" maxLength={240} value={draft.website} placeholder="https://..." onChange={(event) => setDraft({ ...draft, website: event.target.value })} /></label>
                <label className="profile-form-wide"><span>{t.bio}</span><textarea maxLength={360} rows={4} value={draft.bio} placeholder={language === 'vi' ? 'Hướng nghiên cứu, mục tiêu và kinh nghiệm của bạn…' : 'Your research direction, goals, and experience…'} onChange={(event) => setDraft({ ...draft, bio: event.target.value })} /><small>{draft.bio.length}/360</small></label>
                <label className="profile-form-wide"><span>{t.interestInput}</span><input value={draft.interests} placeholder="RAG, Computer vision, Applied mathematics" onChange={(event) => setDraft({ ...draft, interests: event.target.value })} /><small>{t.interestHelp}</small></label>
              </fieldset>
              {error && <div className="profile-form-error" role="alert">{error}</div>}
              <footer><button className="button button--secondary" type="button" disabled={saving} onClick={() => setEditing(false)}>{t.cancel}</button><button className="button button--primary" type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{saving ? t.saving : nameRequired ? t.setupSave : t.save}</button></footer>
            </form>
          </dialog>
      ), document.body)}
    </div>
  );
}
