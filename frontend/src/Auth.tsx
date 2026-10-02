import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  BookOpenCheck,
  Check,
  ChevronDown,
  CircleDollarSign,
  CircleUserRound,
  Compass,
  Crown,
  FileCheck2,
  Github,
  LayoutGrid,
  LibraryBig,
  LogOut,
  Monitor,
  Moon,
  SearchCheck,
  Settings2,
  Shapes,
  ShieldCheck,
  Sparkles,
  Sun,
  UserRound,
  UsersRound,
} from 'lucide-react';
import type { AppView, Language } from './ProductViews';
import type { InformationView } from './InformationPages';
import { BrandMark } from './BrandMark';

export interface AuthUser {
  id: string;
  provider: 'google' | 'github' | 'local' | string;
  name: string;
  email: string | null;
  avatar_url: string | null;
  username: string | null;
  public_name?: string | null;
  role: 'member' | 'admin';
  status: 'active' | 'suspended';
  license_type: 'free' | 'pro' | 'team';
  license_expires_at: string | null;
  display_name?: string | null;
  bio?: string;
  location?: string;
  organization?: string;
  website?: string;
  research_interests?: string[];
  created_at?: string;
  last_login_at?: string;
  login_count?: number;
}

export function displayName(user: AuthUser): string {
  return user.public_name?.trim() || user.display_name?.trim() || user.name;
}

export interface AuthProviders {
  google: boolean;
  github: boolean;
  dev_login: boolean;
}

interface LoginPageProps {
  providers: AuthProviders;
  busy: boolean;
  error: string;
  onOAuth: (provider: 'google' | 'github', remember: boolean) => void;
  onDevelopmentLogin: (remember: boolean) => void;
  onOpenInformation: (view: InformationView) => void;
}

const copy = {
  vi: {
    product: 'DEEP RESEARCH WORKSPACE',
    badge: 'Evidence-first research engine',
    title: 'Nghiên cứu sâu, kiểm chứng rõ, báo cáo có nguồn.',
    description:
      'Biến một câu hỏi mở thành quy trình nghiên cứu đa góc nhìn: lập kế hoạch, truy tìm bằng chứng, đối chiếu nguồn và biên tập báo cáo hoàn chỉnh.',
    cardTitle: 'RESEARCH EVIDENCE BRIEF',
    cardBadge: 'VERIFIED FLOW',
    question: 'AI tạo sinh đang thay đổi năng suất doanh nghiệp như thế nào?',
    synthesis: '12 nguồn được sàng lọc · 3 góc nhìn phản biện',
    facts: ['Nguồn được chấm chất lượng', 'Trích dẫn gắn với luận điểm', 'Audit trước khi xuất report'],
    assurances: [
      ['Tìm kiếm đa nguồn', 'Tavily, Wikipedia và nguồn gốc'],
      ['Nhóm analyst AI', 'Phân tích song song nhiều góc nhìn'],
      ['Báo cáo kiểm chứng', 'Có thư mục nguồn và audit trail'],
      ['Phiên riêng tư', 'Cookie ký, HTTP-only, không lưu token'],
    ],
    welcome: 'Chào mừng trở lại',
    signInHint: 'Đăng nhập để mở không gian nghiên cứu và thư viện báo cáo của bạn.',
    google: 'Tiếp tục với Google',
    github: 'Tiếp tục với GitHub',
    or: 'HOẶC',
    local: 'Dùng tài khoản phát triển cục bộ',
    localHint: 'Chỉ dành cho máy local · không phải tài khoản Google/GitHub',
    unavailable: 'Chưa cấu hình',
    setupTitle: 'OAuth đang chờ cấu hình',
    setupBody: 'Thêm Client ID và Client Secret vào .env để bật nhà cung cấp tương ứng.',
    legal: 'Khi tiếp tục, bạn đồng ý sử dụng tài khoản này cho phiên nghiên cứu trên thiết bị hiện tại.',
    footer: 'Nexora · Multi-agent evidence workspace',
    loading: 'Đang mở phiên…',
  },
  en: {
    product: 'DEEP RESEARCH WORKSPACE',
    badge: 'Evidence-first research engine',
    title: 'Research deeply, verify clearly, report with sources.',
    description:
      'Turn an open question into a multi-perspective workflow: plan, find evidence, compare sources and produce a complete report.',
    cardTitle: 'RESEARCH EVIDENCE BRIEF',
    cardBadge: 'VERIFIED FLOW',
    question: 'How is generative AI changing business productivity?',
    synthesis: '12 sources screened · 3 critical perspectives',
    facts: ['Source quality scoring', 'Claim-linked citations', 'Pre-export evidence audit'],
    assurances: [
      ['Multi-source search', 'Tavily, Wikipedia and primary sources'],
      ['AI analyst team', 'Parallel, multi-angle analysis'],
      ['Verified reports', 'Bibliography and audit trail included'],
      ['Private session', 'Signed HTTP-only cookie, no stored token'],
    ],
    welcome: 'Welcome back',
    signInHint: 'Sign in to open your research workspace and report library.',
    google: 'Continue with Google',
    github: 'Continue with GitHub',
    or: 'OR',
    local: 'Use local development account',
    localHint: 'Local machine only · not a Google/GitHub account',
    unavailable: 'Not configured',
    setupTitle: 'OAuth is waiting for setup',
    setupBody: 'Add the Client ID and Client Secret to .env to enable each provider.',
    legal: 'By continuing, you agree to use this account for research sessions on this device.',
    rememberTitle: 'Keep me signed in',
    rememberHint: 'Remember this account for up to 30 days on this device.',
    sessionHint: 'Leave this off to sign out when the browser session ends.',
    footer: 'Nexora · Multi-agent evidence workspace',
    loading: 'Opening session…',
  },
} as const;

function GoogleMark() {
  return (
    <svg aria-hidden="true" className="google-mark" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.91h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.4Z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.98-.9 6.63-2.43l-3.24-2.53c-.9.6-2.05.96-3.39.96-2.6 0-4.81-1.76-5.6-4.12H3.06v2.61A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.4 13.88A6 6 0 0 1 6.1 12c0-.65.1-1.29.3-1.88V7.51H3.06A10 10 0 0 0 2 12c0 1.61.38 3.14 1.06 4.49l3.34-2.61Z" />
      <path fill="#EA4335" d="M12 6c1.47 0 2.8.51 3.84 1.5l2.88-2.88A9.66 9.66 0 0 0 12 2a10 10 0 0 0-8.94 5.51l3.34 2.61C7.19 7.76 9.4 6 12 6Z" />
    </svg>
  );
}

export function LoginPage({
  providers,
  busy,
  error,
  onOAuth,
  onDevelopmentLogin,
  onOpenInformation,
}: LoginPageProps) {
  const [remember, setRemember] = useState(false);
  const t = copy.en;
  const assuranceIcons = [SearchCheck, UsersRound, FileCheck2, ShieldCheck];
  const anyProvider = providers.google || providers.github;

  useEffect(() => {
    document.documentElement.lang = 'en';
    document.title = 'Nexora — AI research workspace';
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, []);

  return (
    <main className="login-shell">
      <section className="login-story">
        <div className="login-story-grid" aria-hidden="true" />
        <div className="login-story-content">
          <div className="login-brand">
            <span><BrandMark size={48} /></span>
            <div><strong>Nexora</strong><small>{t.product}</small></div>
          </div>

          <div className="login-story-copy">
            <span className="login-engine-badge"><Sparkles size={14} />{t.badge}</span>
            <h1>{t.title}</h1>
            <p>{t.description}</p>
          </div>

          <article className="evidence-preview">
            <header>
              <span><i />{t.cardTitle}</span>
              <strong>{t.cardBadge}</strong>
            </header>
            <div className="evidence-question">
              <BookOpenCheck size={28} />
              <div><small>RESEARCH QUESTION</small><strong>{t.question}</strong></div>
            </div>
            <div className="evidence-synthesis"><Check size={18} />{t.synthesis}</div>
            <div className="evidence-facts">
              {t.facts.map((fact) => <span key={fact}><Check size={15} />{fact}</span>)}
            </div>
          </article>

          <div className="login-assurances">
            {t.assurances.map(([title, detail], index) => {
              const Icon = assuranceIcons[index];
              return <div key={title}><Icon size={20} /><span><strong>{title}</strong><small>{detail}</small></span></div>;
            })}
          </div>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-form-wrap">
          <div className="login-form-heading">
            <span>{t.product}</span>
            <h2>{t.welcome}</h2>
            <p>{t.signInHint}</p>
          </div>

          {error && <div className="auth-alert" role="alert">{error}</div>}

          <label className="remember-choice">
            <input
              type="checkbox"
              checked={remember}
              disabled={busy}
              onChange={(event) => setRemember(event.target.checked)}
            />
            <span className="remember-check" aria-hidden="true">{remember && <Check size={14} />}</span>
            <span className="remember-copy">
              <strong>{t.rememberTitle}</strong>
              <small>{remember ? t.rememberHint : t.sessionHint}</small>
            </span>
          </label>

          <div className="oauth-buttons">
            <button type="button" disabled={busy || !providers.google} onClick={() => onOAuth('google', remember)}>
              <GoogleMark />
              <span>{t.google}</span>
              {!providers.google && <em>{t.unavailable}</em>}
              {providers.google && <ArrowRight size={17} />}
            </button>
            <button type="button" disabled={busy || !providers.github} onClick={() => onOAuth('github', remember)}>
              <Github size={21} />
              <span>{t.github}</span>
              {!providers.github && <em>{t.unavailable}</em>}
              {providers.github && <ArrowRight size={17} />}
            </button>
          </div>

          {!anyProvider && (
            <div className="oauth-setup-note">
              <ShieldCheck size={19} />
              <span><strong>{t.setupTitle}</strong><small>{t.setupBody}</small></span>
            </div>
          )}

          {providers.dev_login && (
            <>
              <div className="auth-divider"><span>{t.or}</span></div>
              <button className="dev-login-button" type="button" disabled={busy} onClick={() => onDevelopmentLogin(remember)}>
                <CircleUserRound size={20} />
                <span><strong>{busy ? t.loading : t.local}</strong><small>{t.localHint}</small></span>
                <ArrowRight size={17} />
              </button>
            </>
          )}

          <p className="auth-legal">{t.legal}</p>
        </div>

        <footer className="login-legal-footer">
          <span>{t.footer}</span>
          <nav aria-label="Legal information">
            <a href="#/privacy" onClick={(event) => { event.preventDefault(); onOpenInformation('privacy'); }}>Privacy</a>
            <a href="#/terms" onClick={(event) => { event.preventDefault(); onOpenInformation('terms'); }}>Terms</a>
            <a href="#/cookies" onClick={(event) => { event.preventDefault(); onOpenInformation('cookies'); }}>Cookies</a>
          </nav>
        </footer>
      </section>
    </main>
  );
}

interface UserMenuProps {
  user: AuthUser;
  language: Language;
  appearance: Appearance;
  onAppearanceChange: (appearance: Appearance) => void;
  reportCount: number;
  sourceCount: number;
  onNavigate: (view: AppView) => void;
  onLogout: () => void;
  onOpenTour: () => void;
}

export type Appearance = 'system' | 'light' | 'dark';

export function UserMenu({ user, language, appearance, onAppearanceChange, reportCount, sourceCount, onNavigate, onLogout, onOpenTour }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const name = displayName(user);
  const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const providerLabel = user.provider === 'local' ? 'Local development' : user.provider;
  const guideCompleted = (() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem('deep-research-guide-progress') || '[]');
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  })();
  const licenseLabel = user.license_type === 'free' ? 'Free' : user.license_type === 'pro' ? 'Pro' : 'Team';
  const go = (view: AppView) => {
    setOpen(false);
    setAppearanceOpen(false);
    onNavigate(view);
  };

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setAppearanceOpen(false);
      }
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (appearanceOpen) setAppearanceOpen(false);
      else setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onEscape);
    };
  }, [appearanceOpen]);

  return (
    <div className="user-menu" ref={rootRef}>
      <button className="user-menu-trigger" type="button" aria-expanded={open} aria-label={language === 'vi' ? 'Mở menu tài khoản' : 'Open account menu'} onClick={() => { setOpen((value) => !value); setAppearanceOpen(false); }}>
        <span className="user-avatar">
          {user.avatar_url && !avatarFailed ? <img src={user.avatar_url} alt="" onError={() => setAvatarFailed(true)} /> : initials}
        </span>
        <span className="user-trigger-copy"><strong>{name}</strong><small>{user.role === 'admin' ? 'Host · ' : ''}{providerLabel}</small></span>
        <ChevronDown size={15} />
      </button>

      {open && (
        <div className="user-menu-popover">
          <button className="user-menu-profile user-menu-profile-button" type="button" onClick={() => go('profile')}>
            <span className="user-avatar user-avatar-large">
              {user.avatar_url && !avatarFailed ? <img src={user.avatar_url} alt="" onError={() => setAvatarFailed(true)} /> : initials}
            </span>
            <span><strong>{name}</strong><small>{user.public_name || user.email || providerLabel}</small></span>
            <ArrowRight size={17} />
          </button>
          <div className="user-menu-membership">
            <span><Crown size={16} /><strong>{licenseLabel}</strong> {language === 'vi' ? 'workspace' : 'workspace'}</span>
            <small>{user.role === 'admin' ? (language === 'vi' ? 'Quyền Host đã xác minh' : 'Verified Host access') : (language === 'vi' ? 'Hồ sơ nghiên cứu cá nhân' : 'Personal research profile')}</small>
          </div>
          <div className="user-menu-quick" aria-label={language === 'vi' ? 'Lối tắt tài khoản' : 'Account shortcuts'}>
            <button type="button" onClick={() => go('profile')}><UserRound size={20} /><strong>{language === 'vi' ? 'Hồ sơ' : 'Profile'}</strong><small>{language === 'vi' ? 'Xem tiến độ' : 'View progress'}</small></button>
            <button type="button" onClick={() => go('reports')}><LibraryBig size={20} /><strong>{language === 'vi' ? 'Báo cáo' : 'Reports'}</strong><small>{reportCount}</small></button>
            <button type="button" onClick={() => go('domains')}><Shapes size={20} /><strong>{language === 'vi' ? 'Lĩnh vực' : 'Fields'}</strong><small>{sourceCount} {language === 'vi' ? 'nguồn' : 'sources'}</small></button>
            <button type="button" onClick={() => go('guide')}><BadgeCheck size={20} /><strong>{language === 'vi' ? 'Tiến độ' : 'Progress'}</strong><small>{guideCompleted}/15 {language === 'vi' ? 'bài' : 'lessons'}</small></button>
          </div>
          <div className="user-provider"><ShieldCheck size={14} /><span>{user.role === 'admin' ? 'Host · ' : ''}{language === 'vi' ? 'Đăng nhập qua' : 'Signed in with'} <strong>{providerLabel}</strong></span></div>
          <div className="user-menu-links">
            <button type="button" onClick={() => go('collab')}><UsersRound size={17} />{language === 'vi' ? 'Dự án & nhóm nghiên cứu' : 'Projects & research groups'}</button>
            <button type="button" onClick={() => { setOpen(false); onOpenTour(); }}><Compass size={17} />{language === 'vi' ? 'Tour hướng dẫn' : 'Guided tours'}</button>
            <button type="button" onClick={() => go('settings')}><Settings2 size={17} />{language === 'vi' ? 'Cài đặt workspace' : 'Workspace settings'}</button>
            <button type="button" onClick={() => go('guide')}><BookOpenCheck size={17} />{language === 'vi' ? 'Hướng dẫn sử dụng' : 'Product guide'}</button>
            <button type="button" onClick={() => go('pricing')}><CircleDollarSign size={17} />{language === 'vi' ? 'Gói & license' : 'Plans & licenses'}</button>
            {user.role === 'admin' && <button type="button" onClick={() => go('admin')}><LayoutGrid size={17} />Host Console</button>}
            <div className="user-menu-appearance">
              <button type="button" aria-expanded={appearanceOpen} aria-controls="appearance-options" onClick={() => setAppearanceOpen((value) => !value)}>
                {appearance === 'dark' ? <Moon size={17} /> : appearance === 'light' ? <Sun size={17} /> : <Monitor size={17} />}
                {language === 'vi' ? 'Giao diện' : 'Appearance'}
                <ChevronDown className="appearance-chevron" size={15} />
              </button>
              {appearanceOpen && <div className="appearance-options" id="appearance-options" role="radiogroup" aria-label={language === 'vi' ? 'Chọn giao diện' : 'Choose appearance'}>
                {([
                  ['system', Monitor, language === 'vi' ? 'Theo hệ thống' : 'System default'],
                  ['light', Sun, language === 'vi' ? 'Sáng' : 'Light'],
                  ['dark', Moon, language === 'vi' ? 'Tối' : 'Dark'],
                ] as const).map(([value, Icon, label]) => <button key={value} type="button" role="radio" aria-checked={appearance === value} className={appearance === value ? 'is-selected' : ''} onClick={() => { onAppearanceChange(value); setAppearanceOpen(false); }}><Icon size={17} /><span>{label}</span>{appearance === value && <Check size={16} />}</button>)}
              </div>}
            </div>
          </div>
          <button className="logout-button" type="button" onClick={() => { setOpen(false); onLogout(); }}><LogOut size={17} />{language === 'vi' ? 'Đăng xuất' : 'Sign out'}</button>
        </div>
      )}
    </div>
  );
}

export function WelcomeTransition({ user, language }: { user: AuthUser; language: Language }) {
  const name = displayName(user);
  const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  return (
    <div className="welcome-transition" role="status" aria-live="polite">
      <div className="welcome-transition-orbit" aria-hidden="true"><i /><i /><i /></div>
      <div className="welcome-transition-avatar">
        {user.avatar_url ? <img src={user.avatar_url} alt="" /> : initials}
        <span><Check size={15} /></span>
      </div>
      <small>{language === 'vi' ? 'PHIÊN ĐÃ ĐƯỢC XÁC THỰC' : 'SESSION AUTHENTICATED'}</small>
      <strong>{language === 'vi' ? `Chào ${name}` : `Welcome, ${name}`}</strong>
      <p>{language === 'vi' ? 'Đang chuẩn bị không gian nghiên cứu của bạn…' : 'Preparing your research workspace…'}</p>
      <div className="welcome-progress"><i /></div>
    </div>
  );
}
