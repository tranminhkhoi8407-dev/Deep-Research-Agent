import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
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
  Eye,
  EyeOff,
  FileCheck2,
  Github,
  LayoutGrid,
  LibraryBig,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Monitor,
  Moon,
  SearchCheck,
  Settings2,
  Shapes,
  ShieldCheck,
  Sparkles,
  Sun,
  TriangleAlert,
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
  password: boolean;
  google: boolean;
  github: boolean;
  dev_login: boolean;
}

interface LoginPageProps {
  providers: AuthProviders;
  busy: boolean;
  error: string;
  onOAuth: (provider: 'google' | 'github') => void;
  onPasswordLogin: (payload: { identifier: string; password: string }) => Promise<void>;
  onPasswordRegister: (payload: { name: string; username: string; email: string; password: string }) => Promise<void>;
  onForgotPassword: (payload: { email: string }) => Promise<void>;
  onResetPassword: (payload: { token: string; password: string }) => Promise<void>;
  onDevelopmentLogin: () => void;
  onOpenInformation: (view: InformationView) => void;
}

export type AuthView = 'signin' | 'signup' | 'forgot' | 'reset';

const USERNAME_RE = /^[A-Za-z0-9._-]{3,30}$/;

function isValidIdentifier(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 320) return false;
  if (trimmed.includes('@')) return EMAIL_RE.test(trimmed);
  return USERNAME_RE.test(trimmed);
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
      ['Tìm kiếm đa nguồn', 'Tavily, PDF và tài liệu công khai'],
      ['Nhóm analyst AI', 'Phân tích song song nhiều góc nhìn'],
      ['Báo cáo kiểm chứng', 'Có thư mục nguồn và audit trail'],
      ['Phiên riêng tư', 'Cookie ký, HTTP-only, không lưu token'],
    ],
    welcome: 'Chào mừng trở lại',
    signInHint: 'Đăng nhập để mở không gian nghiên cứu và thư viện báo cáo của bạn.',
    google: 'Tiếp tục với Google',
    github: 'Tiếp tục với GitHub',
    signInTab: 'Đăng nhập',
    registerTab: 'Đăng ký',
    nameLabel: 'Họ và tên',
    namePlaceholder: 'Nguyễn Văn A',
    emailLabel: 'Email',
    emailPlaceholder: 'ban@example.com',
    passwordLabel: 'Mật khẩu',
    passwordPlaceholder: 'Tối thiểu 8 ký tự',
    confirmPasswordLabel: 'Nhập lại mật khẩu',
    confirmPasswordPlaceholder: 'Nhập lại mật khẩu',
    signInButton: 'Đăng nhập bằng email',
    registerButton: 'Tạo tài khoản',
    credentialsHint: 'Dùng email và mật khẩu để vào workspace ngay trên thiết bị này.',
    registerHint: 'Tạo tài khoản mới với email và mật khẩu riêng cho Nexora.',
    passwordMismatch: 'Mật khẩu nhập lại chưa khớp.',
    nameRequired: 'Vui lòng nhập họ tên của bạn (ít nhất 2 ký tự).',
    nameTooLong: 'Họ tên tối đa 80 ký tự.',
    emailRequired: 'Vui lòng nhập email hợp lệ (ví dụ: ban@example.com).',
    passwordRequired: 'Mật khẩu cần ít nhất 8 ký tự.',
    passwordLettersNumbers: 'Mật khẩu cần có cả chữ cái và số.',
    passwordCommon: 'Mật khẩu này quá phổ biến, vui lòng chọn mật khẩu khác.',
    showPassword: 'Hiện mật khẩu',
    hidePassword: 'Ẩn mật khẩu',
    capsLock: 'Đang bật Caps Lock — hãy kiểm tra lại.',
    strengthLabel: 'Độ mạnh mật khẩu',
    strengthLevels: ['Yếu', 'Trung bình', 'Khá', 'Mạnh'],
    strengthHints: ['Ít nhất 8 ký tự', 'Có chữ hoa + chữ thường', 'Có số', 'Có ký tự đặc biệt + dài 12+'],
    needAccount: 'Chưa có tài khoản?',
    haveAccount: 'Đã có tài khoản?',
    switchToRegister: 'Tạo tài khoản mới',
    switchToSignIn: 'Đăng nhập ngay',
    registerSuccessHint: 'Tài khoản được tạo và đăng nhập ngay, phiên ghi nhớ 30 ngày.',
    emailHintSignIn: 'Nhập email bạn đã đăng ký để vào workspace.',
    emailHintSignUp: 'Email dùng để đăng nhập và nhận diện workspace của bạn.',
    or: 'HOẶC',
    local: 'Dùng tài khoản phát triển cục bộ',
    localHint: 'Chỉ dành cho máy local · không phải tài khoản Google/GitHub',
    unavailable: 'Chưa cấu hình',
    setupTitle: 'OAuth đang chờ cấu hình',
    setupBody: 'Thêm Client ID và Client Secret vào .env để bật nhà cung cấp tương ứng.',
    legal: 'Đăng nhập được tự ghi nhớ tối đa 30 ngày. Hãy đăng xuất khi dùng xong trên máy dùng chung. Nexora không lưu mật khẩu Google/GitHub và mật khẩu nội bộ được lưu dưới dạng băm scrypt an toàn.',
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
      ['Multi-source search', 'Tavily, PDFs and public documents'],
      ['AI analyst team', 'Parallel, multi-angle analysis'],
      ['Verified reports', 'Bibliography and audit trail included'],
      ['Private session', 'Signed HTTP-only cookie, no stored token'],
    ],
    welcome: 'Welcome back',
    signInHint: 'Sign in to open your research workspace and report library.',
    google: 'Continue with Google',
    github: 'Continue with GitHub',
    signInTab: 'Sign in',
    registerTab: 'Register',
    nameLabel: 'Full name',
    namePlaceholder: 'Alex Johnson',
    identifierLabel: 'Username or email address',
    identifierPlaceholder: 'Enter your username or email',
    identifierRequired: 'Please enter your username or email address.',
    usernameLabel: 'Username',
    usernamePlaceholder: 'Choose a username (3-30 characters)',
    usernameRequired: 'Username must be 3-30 characters: letters, numbers, dot, underscore or hyphen.',
    usernameTaken: 'This username is already taken.',
    emailLabel: 'Email',
    emailPlaceholder: 'you@example.com',
    passwordLabel: 'Password',
    passwordPlaceholder: 'At least 8 characters',
    confirmPasswordLabel: 'Confirm password',
    confirmPasswordPlaceholder: '',
    forgotPassword: 'Forgot password?',
    forgotTitle: 'Forgot password',
    forgotHint: 'Enter the email address for your account and we will send you a password reset link.',
    forgotEmailLabel: 'Email',
    forgotEmailPlaceholder: 'Enter your email address',
    forgotSubmit: 'Send password reset email',
    forgotSending: 'Sending reset email…',
    forgotSentTitle: 'Check your inbox',
    forgotSentBody: 'If an account uses this email, a password reset link has been sent. The link expires in 60 minutes.',
    forgotBack: 'Back to sign in',
    resetTitle: 'Set a new password',
    resetHint: 'Enter a new password for your account.',
    resetSubmit: 'Reset password',
    resetInvalid: 'This reset link is invalid or has expired. Please request a new one.',
    signInButton: 'Sign in',
    registerButton: 'Create account',
    passwordMismatch: 'The password confirmation does not match.',
    nameRequired: 'Please enter your name (at least 2 characters).',
    nameTooLong: 'Name must be 80 characters or fewer.',
    emailRequired: 'Please enter a valid email address (e.g. you@example.com).',
    passwordRequired: 'Password must be at least 8 characters.',
    passwordLettersNumbers: 'Password must include both letters and numbers.',
    passwordCommon: 'This password is too common. Please choose another one.',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
    capsLock: 'Caps Lock is on — please double-check.',
    strengthLabel: 'Password strength',
    strengthLevels: ['Weak', 'Fair', 'Good', 'Strong'],
    strengthHints: ['At least 8 characters', 'Upper + lowercase', 'Includes a number', 'Symbol + 12 or more chars'],
    needAccount: "Don't have an account?",
    haveAccount: 'Already have an account?',
    switchToRegister: 'Create an account',
    switchToSignIn: 'Sign in instead',
    createAccountTitle: 'Create an account',
    createAccountHint: 'Create a new Nexora account to open your research workspace.',
    registerSuccessHint: 'Your account is created and signed in right away, remembered for 30 days.',
    emailHintSignIn: 'Enter the email you registered to open your workspace.',
    emailHintSignUp: 'This email signs you in and identifies your workspace.',
    or: 'OR',
    local: 'Use local development account',
    localHint: 'Local machine only · not a Google/GitHub account',
    unavailable: 'Not configured',
    setupTitle: 'OAuth is waiting for setup',
    setupBody: 'Add the Client ID and Client Secret to .env to enable each provider.',
    legal: 'Sign-in is automatically remembered for up to 30 days. Sign out when finished on shared devices. Nexora does not store Google/GitHub passwords and stores built-in passwords as secure hashes.',
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', 'qwerty', 'qwerty123',
  'abc12345', '11111111', '00000000', 'iloveyou', 'admin123', 'welcome1',
]);

export function storeLoginCredential(identifier: string, password: string): void {
  // Single-page apps never navigate after sign-in, so password managers often
  // miss the login. Storing via the Credential Management API explicitly asks
  // the browser to remember it (Chrome/Edge). Best effort: never break auth.
  try {
    const CredentialCtor = (window as unknown as { PasswordCredential?: new (data: { id: string; password: string }) => Credential }).PasswordCredential;
    const container = (navigator as Navigator & { credentials?: { store(credential: Credential): Promise<unknown> } }).credentials;
    if (typeof CredentialCtor === 'undefined' || !container || typeof container.store !== 'function') return;
    if ('isSecureContext' in window && window.isSecureContext === false) return;
    const id = identifier.trim();
    if (!id || !password) return;
    void container.store(new CredentialCtor({ id, password })).catch(() => { /* User dismissed the prompt. */ });
  } catch { /* Older browsers. */ }
}

export function scorePassword(value: string): { score: 0 | 1 | 2 | 3 | 4; hasLength: boolean; hasCase: boolean; hasNumber: boolean; hasSymbolLong: boolean } {
  const hasLength = value.length >= 8;
  const hasLower = /[a-z]/.test(value);
  const hasUpper = /[A-Z]/.test(value);
  const hasCase = hasLower && hasUpper;
  const hasNumber = /[0-9]/.test(value);
  const hasSymbol = /[^A-Za-z0-9]/.test(value);
  const hasSymbolLong = hasSymbol && value.length >= 12;
  let score = 0;
  if (hasLength) score += 1;
  if ((hasLower || hasUpper) && hasNumber) score += 1;
  if ((hasCase && hasNumber) || (hasSymbol && value.length >= 10)) score += 1;
  if (value.length >= 12 && hasCase && hasNumber && hasSymbol) score += 1;
  if (COMMON_PASSWORDS.has(value.trim().toLowerCase())) score = 0;
  return { score: Math.min(4, score) as 0 | 1 | 2 | 3 | 4, hasLength, hasCase, hasNumber, hasSymbolLong };
}

export function LoginPage({
  providers,
  busy,
  error,
  onOAuth,
  onPasswordLogin,
  onPasswordRegister,
  onForgotPassword,
  onResetPassword,
  onDevelopmentLogin,
  onOpenInformation,
}: LoginPageProps) {
  const t = copy.en;
  const assuranceIcons = [SearchCheck, UsersRound, FileCheck2, ShieldCheck];
  const anyProvider = providers.google || providers.github;
  const [view, setView] = useState<AuthView>(() => {
    try {
      const token = new URLSearchParams(window.location.search).get('reset_token');
      if (token && token.trim()) return 'reset';
    } catch { /* Non-browser or blocked URL access. */ }
    return 'signin';
  });
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; username?: string; identifier?: string; email?: string; password?: string; confirm?: string }>({});
  const [touched, setTouched] = useState<{ name: boolean; username: boolean; identifier: boolean; email: boolean; password: boolean; confirm: boolean }>({ name: false, username: false, identifier: false, email: false, password: false, confirm: false });
  const [resetToken, setResetToken] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('reset_token')?.trim() || '';
    } catch {
      return '';
    }
  });
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotError, setForgotError] = useState('');
  const nameId = useId();
  const usernameId = useId();
  const identifierId = useId();
  const emailId = useId();
  const passwordId = useId();
  const confirmId = useId();
  const forgotEmailId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const identifierRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const strength = useMemo(() => scorePassword(password), [password]);
  const passwordStrongEnough = (value: string): string | null => {
    if (value.length < 8) return t.passwordRequired;
    if (COMMON_PASSWORDS.has(value.trim().toLowerCase())) return t.passwordCommon;
    if (!(/[A-Za-z]/.test(value) && /[0-9]/.test(value))) return t.passwordLettersNumbers;
    return null;
  };
  const formValid = useMemo(() => {
    if (view === 'forgot') return EMAIL_RE.test(email.trim());
    if (view === 'reset') {
      return passwordStrongEnough(password) === null && password === confirmPassword;
    }
    if (view === 'signin') {
      if (!isValidIdentifier(identifier)) return false;
      return password.length >= 8;
    }
    const trimmedName = name.trim().replace(/\s+/g, ' ');
    if (trimmedName.length < 2 || trimmedName.length > 80) return false;
    if (!USERNAME_RE.test(username.trim())) return false;
    if (!EMAIL_RE.test(email.trim())) return false;
    if (passwordStrongEnough(password) !== null) return false;
    if (password !== confirmPassword) return false;
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, identifier, name, username, email, password, confirmPassword]);

  useEffect(() => {
    document.documentElement.lang = 'en';
    document.title = 'Nexora — AI research workspace';
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, []);

  useEffect(() => {
    setFieldErrors({});
  }, [view, error]);

  const validateAll = (): boolean => {
    const next: typeof fieldErrors = {};
    if (view === 'forgot') {
      if (!EMAIL_RE.test(email.trim())) next.email = t.emailRequired;
      setFieldErrors(next);
      setTouched((prev) => ({ ...prev, email: true }));
      if (next.email) emailRef.current?.focus();
      return Object.keys(next).length === 0;
    }
    if (view === 'reset') {
      const problem = passwordStrongEnough(password);
      if (problem) next.password = problem;
      if (password !== confirmPassword) next.confirm = t.passwordMismatch;
      setFieldErrors(next);
      setTouched((prev) => ({ ...prev, password: true, confirm: true }));
      if (next.password) passwordRef.current?.focus();
      return Object.keys(next).length === 0;
    }
    if (view === 'signin' && !isValidIdentifier(identifier)) next.identifier = t.identifierRequired;
    if (view === 'signin') {
      if (password.length < 8) next.password = t.passwordRequired;
    } else {
      const trimmedName = name.trim().replace(/\s+/g, ' ');
      if (trimmedName.length < 2) next.name = t.nameRequired;
      else if (trimmedName.length > 80) next.name = t.nameTooLong;
      if (!USERNAME_RE.test(username.trim())) next.username = t.usernameRequired;
      if (!EMAIL_RE.test(email.trim())) next.email = t.emailRequired;
      const problem = passwordStrongEnough(password);
      if (problem) next.password = problem;
      if (password !== confirmPassword) next.confirm = t.passwordMismatch;
    }
    setFieldErrors(next);
    setTouched({ name: true, username: true, identifier: true, email: true, password: true, confirm: true });
    if (next.name) nameRef.current?.focus();
    else if (next.identifier) identifierRef.current?.focus();
    else if (next.username || next.email) emailRef.current?.focus();
    else if (next.password || next.confirm) passwordRef.current?.focus();
    return Object.keys(next).length === 0;
  };

  const validateLive = (field: 'name' | 'username' | 'identifier' | 'email' | 'password' | 'confirm') => {
    if (!touched[field]) return;
    setFieldErrors((current) => {
      const next = { ...current };
      if (field === 'identifier') {
        if (isValidIdentifier(identifier)) delete next.identifier;
        else next.identifier = t.identifierRequired;
      }
      if (field === 'username') {
        if (USERNAME_RE.test(username.trim())) delete next.username;
        else next.username = t.usernameRequired;
      }
      if (field === 'email') {
        if (EMAIL_RE.test(email.trim())) delete next.email;
        else next.email = t.emailRequired;
      }
      if (field === 'password') {
        if (view === 'signin') {
          if (password.length < 8) next.password = t.passwordRequired;
          else delete next.password;
        } else {
          const problem = passwordStrongEnough(password);
          if (problem) next.password = problem;
          else delete next.password;
        }
        if ((view === 'signup' || view === 'reset') && confirmPassword && password !== confirmPassword) next.confirm = t.passwordMismatch;
        else if (password === confirmPassword) delete next.confirm;
      }
      if (field === 'name' && view === 'signup') {
        const trimmedName = name.trim().replace(/\s+/g, ' ');
        if (trimmedName.length < 2) next.name = t.nameRequired;
        else if (trimmedName.length > 80) next.name = t.nameTooLong;
        else delete next.name;
      }
      if (field === 'confirm' && (view === 'signup' || view === 'reset')) {
        if (password !== confirmPassword) next.confirm = t.passwordMismatch;
        else delete next.confirm;
      }
      return next;
    });
  };

  const checkCapsLock = (event: React.KeyboardEvent) => {
    try {
      const active = typeof event.getModifierState === 'function' && event.getModifierState('CapsLock');
      setCapsLock(Boolean(active));
    } catch { /* Older browsers. */ }
  };

  const switchView = (next: AuthView) => {
    if (busy || forgotBusy || next === view) return;
    // Never carry passwords between screens: a password typed (or autofilled)
    // on one screen must not appear pre-filled on another.
    setPassword('');
    setConfirmPassword('');
    if (next === 'forgot') {
      setForgotSent(false);
      if (!email.trim() && EMAIL_RE.test(identifier.trim())) setEmail(identifier.trim());
    }
    if (next === 'signin' && !identifier.trim() && EMAIL_RE.test(email.trim())) setIdentifier(email.trim());
    if (next === 'signup' && !email.trim() && EMAIL_RE.test(identifier.trim())) setEmail(identifier.trim());
    setView(next);
    setFieldErrors({});
    setForgotError('');
    setTouched({ name: false, username: false, identifier: false, email: false, password: false, confirm: false });
    setShowPassword(false);
    setShowConfirm(false);
    setCapsLock(false);
  };

  const clearResetTokenFromUrl = () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('reset_token');
      url.searchParams.delete('auth');
      url.searchParams.delete('auth_error');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    } catch { /* URL API unavailable. */ }
  };

  const submitCredentials = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (!validateAll()) return;
    const trimmedName = name.trim().replace(/\s+/g, ' ');
    try {
      if (view === 'signup') await onPasswordRegister({ name: trimmedName, username: username.trim(), email: email.trim(), password });
      else await onPasswordLogin({ identifier: identifier.trim(), password });
    } catch {
      /* App-level auth state already renders the server error. */
    }
  };

  const submitForgot = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || forgotBusy) return;
    if (!EMAIL_RE.test(email.trim())) {
      setFieldErrors({ email: t.emailRequired });
      setTouched((prev) => ({ ...prev, email: true }));
      emailRef.current?.focus();
      return;
    }
    setForgotBusy(true);
    setForgotError('');
    try {
      await onForgotPassword({ email: email.trim() });
      setForgotSent(true);
    } catch (err) {
      setForgotError(err instanceof Error ? err.message : t.forgotSentBody);
    } finally {
      setForgotBusy(false);
    }
  };

  const submitReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (!validateAll()) return;
    if (!resetToken) {
      setFieldErrors({ password: t.resetInvalid });
      return;
    }
    try {
      await onResetPassword({ token: resetToken, password });
      clearResetTokenFromUrl();
      setResetToken('');
    } catch {
      /* App-level auth state already renders the server error. */
    }
  };

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

      <section className="login-panel" aria-label={t.welcome}>
        <div className="login-form-wrap">
          <div className="login-panel-topbar">
            <span className="login-panel-eyebrow">{t.product}</span>
          </div>
          <div className="login-form-heading">
            <h2>{view === 'signup' ? t.createAccountTitle : view === 'forgot' ? t.forgotTitle : view === 'reset' ? t.resetTitle : t.welcome}</h2>
            <p>{view === 'signup' ? t.createAccountHint : view === 'forgot' ? t.forgotHint : view === 'reset' ? t.resetHint : t.signInHint}</p>
          </div>

          {error && view !== 'forgot' && <div className="auth-alert" role="alert"><TriangleAlert size={16} aria-hidden="true" /><span>{error}</span></div>}
          {view === 'forgot' ? (
            forgotSent ? (
              <div className="credential-form" role="status" aria-live="polite">
                <div className="auth-success">
                  <span className="auth-success-icon"><Check size={20} aria-hidden="true" /></span>
                  <div>
                    <strong>{t.forgotSentTitle}</strong>
                    <p>{t.forgotSentBody}</p>
                  </div>
                </div>
                <button className="credential-submit" type="button" onClick={() => switchView('signin')}>
                  <span>{t.forgotBack}</span>
                  <ArrowRight size={17} aria-hidden="true" />
                </button>
              </div>
            ) : (
              <form className="credential-form" onSubmit={(event) => void submitForgot(event)} noValidate>
                {forgotError && <div className="auth-alert" role="alert"><TriangleAlert size={16} aria-hidden="true" /><span>{forgotError}</span></div>}
                <div className="auth-field">
                  <label htmlFor={forgotEmailId}>{t.forgotEmailLabel}</label>
                  <input
                    id={forgotEmailId}
                    ref={emailRef}
                    type="email"
                    name="email"
                    inputMode="email"
                    autoComplete="email"
                    spellCheck={false}
                    value={email}
                    onChange={(event) => { setEmail(event.target.value); setTouched((prev) => ({ ...prev, email: true })); }}
                    onBlur={() => validateLive('email')}
                    placeholder={t.forgotEmailPlaceholder}
                    disabled={busy || forgotBusy}
                    aria-invalid={Boolean(fieldErrors.email)}
                    aria-describedby={fieldErrors.email ? `${forgotEmailId}-error` : undefined}
                  />
                  {fieldErrors.email && <p id={`${forgotEmailId}-error`} className="auth-field-error" role="alert">{fieldErrors.email}</p>}
                </div>
                <button className="credential-submit credential-submit--reset" type="submit" disabled={busy || forgotBusy || !EMAIL_RE.test(email.trim())}>
                  {forgotBusy ? <LoaderCircle size={18} className="spin" aria-hidden="true" /> : null}
                  <span>{forgotBusy ? t.forgotSending : t.forgotSubmit}</span>
                </button>
                <p className="auth-switch-line">
                  <button type="button" className="auth-switch-button" disabled={busy || forgotBusy} onClick={() => switchView('signin')}>
                    {t.forgotBack}
                  </button>
                </p>
              </form>
            )
          ) : view === 'reset' ? (
            <form className="credential-form" onSubmit={(event) => void submitReset(event)} noValidate>
              {!resetToken && <div className="auth-alert" role="alert"><TriangleAlert size={16} aria-hidden="true" /><span>{t.resetInvalid}</span></div>}
              <div className="auth-field">
                <label htmlFor={passwordId}>{t.passwordLabel}</label>
                <div className="auth-password-wrap">
                  <input
                    id={passwordId}
                    ref={passwordRef}
                    type={showPassword ? 'text' : 'password'}
                    name="new-password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => { setPassword(event.target.value); setTouched((prev) => ({ ...prev, password: true })); }}
                    onBlur={() => { validateLive('password'); setCapsLock(false); }}
                    onKeyUp={checkCapsLock}
                    placeholder={t.passwordPlaceholder}
                    disabled={busy}
                    aria-invalid={Boolean(fieldErrors.password)}
                    aria-describedby={fieldErrors.password ? `${passwordId}-error` : undefined}
                  />
                  <button
                    type="button"
                    className="auth-password-toggle"
                    onClick={() => setShowPassword((value) => !value)}
                    disabled={busy}
                    aria-label={showPassword ? t.hidePassword : t.showPassword}
                    aria-pressed={showPassword}
                    title={showPassword ? t.hidePassword : t.showPassword}
                  >
                    {showPassword ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                  </button>
                </div>
                {capsLock && password.length > 0 && <p id={`${passwordId}-caps`} className="auth-field-warning" role="status">{t.capsLock}</p>}
                {fieldErrors.password && <p id={`${passwordId}-error`} className="auth-field-error" role="alert">{fieldErrors.password}</p>}
              </div>
              <div className="auth-field">
                <label htmlFor={confirmId}>{t.confirmPasswordLabel}</label>
                <div className="auth-password-wrap">
                    <input
                      id={confirmId}
                      type={showConfirm ? 'text' : 'password'}
                      name="new-password-confirm"
                      autoComplete="new-password"
                      value={confirmPassword}
                    onChange={(event) => { setConfirmPassword(event.target.value); setTouched((prev) => ({ ...prev, confirm: true })); }}
                    onBlur={() => validateLive('confirm')}
                    disabled={busy}
                    aria-invalid={Boolean(fieldErrors.confirm)}
                    aria-describedby={fieldErrors.confirm ? `${confirmId}-error` : undefined}
                  />
                  <button
                    type="button"
                    className="auth-password-toggle"
                    onClick={() => setShowConfirm((value) => !value)}
                    disabled={busy}
                    aria-label={showConfirm ? t.hidePassword : t.showPassword}
                    aria-pressed={showConfirm}
                    title={showConfirm ? t.hidePassword : t.showPassword}
                  >
                    {showConfirm ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                  </button>
                </div>
                {fieldErrors.confirm && <p id={`${confirmId}-error`} className="auth-field-error" role="alert">{fieldErrors.confirm}</p>}
              </div>
              <button className="credential-submit credential-submit--reset" type="submit" disabled={busy || !formValid}>
                {busy ? <LoaderCircle size={18} className="spin" aria-hidden="true" /> : null}
                <span>{busy ? t.loading : t.resetSubmit}</span>
                {!busy && <ArrowRight size={17} aria-hidden="true" />}
              </button>
              <p className="auth-switch-line">
                <button type="button" className="auth-switch-button" disabled={busy} onClick={() => { clearResetTokenFromUrl(); setResetToken(''); switchView('signin'); }}>
                  {t.forgotBack}
                </button>
              </p>
            </form>
          ) : providers.password && (
            <>
              <form id="auth-panel-credentials" className="credential-form" onSubmit={(event) => void submitCredentials(event)} noValidate>
                {view === 'signup' && (
                  <>
                    <div className="auth-field">
                      <label htmlFor={nameId}>{t.nameLabel}</label>
                      <input
                        id={nameId}
                        ref={nameRef}
                        type="text"
                        name="name"
                        autoComplete="name"
                        maxLength={80}
                        value={name}
                        onChange={(event) => { setName(event.target.value); setTouched((prev) => ({ ...prev, name: true })); }}
                        onBlur={() => validateLive('name')}
                        placeholder={t.namePlaceholder}
                        disabled={busy}
                        aria-invalid={Boolean(fieldErrors.name)}
                        aria-describedby={fieldErrors.name ? `${nameId}-error` : undefined}
                      />
                      {fieldErrors.name && <p id={`${nameId}-error`} className="auth-field-error" role="alert">{fieldErrors.name}</p>}
                    </div>
                    <div className="auth-field">
                      <label htmlFor={usernameId}>{t.usernameLabel}</label>
                      <input
                        id={usernameId}
                        type="text"
                        name="username"
                        autoComplete="username"
                        maxLength={30}
                        spellCheck={false}
                        value={username}
                        onChange={(event) => { setUsername(event.target.value); setTouched((prev) => ({ ...prev, username: true })); }}
                        onBlur={() => validateLive('username')}
                        placeholder={t.usernamePlaceholder}
                        disabled={busy}
                        aria-invalid={Boolean(fieldErrors.username)}
                        aria-describedby={fieldErrors.username ? `${usernameId}-error` : undefined}
                      />
                      {fieldErrors.username && <p id={`${usernameId}-error`} className="auth-field-error" role="alert">{fieldErrors.username}</p>}
                    </div>
                  </>
                )}
                {view === 'signup' ? (
                  <div className="auth-field">
                    <label htmlFor={emailId}>{t.emailLabel}</label>
                    <input
                      id={emailId}
                      ref={emailRef}
                      type="email"
                      name="email"
                      inputMode="email"
                      autoComplete="email"
                      spellCheck={false}
                      value={email}
                      onChange={(event) => { setEmail(event.target.value); setTouched((prev) => ({ ...prev, email: true })); }}
                      onBlur={() => validateLive('email')}
                      placeholder={t.emailPlaceholder}
                      disabled={busy}
                      aria-invalid={Boolean(fieldErrors.email)}
                      aria-describedby={fieldErrors.email ? `${emailId}-error` : undefined}
                    />
                    {fieldErrors.email && <p id={`${emailId}-error`} className="auth-field-error" role="alert">{fieldErrors.email}</p>}
                  </div>
                ) : (
                  <div className="auth-field">
                    <label htmlFor={identifierId}>{t.identifierLabel}</label>
                    <input
                      id={identifierId}
                      ref={identifierRef}
                      type="text"
                      name="username"
                      inputMode="email"
                      autoComplete="username"
                      spellCheck={false}
                      value={identifier}
                      onChange={(event) => { setIdentifier(event.target.value); setTouched((prev) => ({ ...prev, identifier: true })); }}
                      onBlur={() => validateLive('identifier')}
                      placeholder={t.identifierPlaceholder}
                      disabled={busy}
                      aria-invalid={Boolean(fieldErrors.identifier)}
                      aria-describedby={fieldErrors.identifier ? `${identifierId}-error` : undefined}
                    />
                    {fieldErrors.identifier && <p id={`${identifierId}-error`} className="auth-field-error" role="alert">{fieldErrors.identifier}</p>}
                  </div>
                )}
                <div className="auth-field">
                  <div className="auth-label-row">
                    <label htmlFor={passwordId}>{t.passwordLabel}</label>
                    {view === 'signin' && (
                      <button
                        type="button"
                        className="auth-forgot-link"
                        disabled={busy}
                        onClick={() => switchView('forgot')}
                      >
                        {t.forgotPassword}
                      </button>
                    )}
                  </div>
                  <div className="auth-password-wrap">
                    <input
                      id={passwordId}
                      ref={passwordRef}
                      type={showPassword ? 'text' : 'password'}
                      name="password"
                      autoComplete={view === 'signup' ? 'new-password' : 'current-password'}
                      value={password}
                      onChange={(event) => { setPassword(event.target.value); setTouched((prev) => ({ ...prev, password: true })); }}
                      onBlur={() => { validateLive('password'); setCapsLock(false); }}
                      onKeyUp={checkCapsLock}
                      placeholder={t.passwordPlaceholder}
                      disabled={busy}
                      aria-invalid={Boolean(fieldErrors.password)}
                      aria-describedby={fieldErrors.password ? `${passwordId}-error` : undefined}
                    />
                    <button
                      type="button"
                      className="auth-password-toggle"
                      onClick={() => setShowPassword((value) => !value)}
                      disabled={busy}
                      aria-label={showPassword ? t.hidePassword : t.showPassword}
                      aria-pressed={showPassword}
                      title={showPassword ? t.hidePassword : t.showPassword}
                    >
                      {showPassword ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                    </button>
                  </div>
                  {capsLock && password.length > 0 && <p id={`${passwordId}-caps`} className="auth-field-warning" role="status">{t.capsLock}</p>}
                  {view === 'signup' && (
                    <div className="password-strength" aria-live="polite">
                      <div className="password-strength-bar" aria-hidden="true">
                        {[0, 1, 2, 3].map((index) => (
                          <i key={index} className={strength.score > index ? `is-on level-${strength.score}` : ''} />
                        ))}
                      </div>
                      <div className="password-strength-meta">
                        <span>{t.strengthLabel}: <strong className={`strength-${strength.score}`}>{strength.score === 0 ? t.strengthLevels[0] : t.strengthLevels[Math.min(3, strength.score - 1)]}</strong></span>
                      </div>
                      <ul className="password-checklist">
                        <li className={strength.hasLength ? 'is-met' : ''}><Check size={13} aria-hidden="true" />{t.strengthHints[0]}</li>
                        <li className={strength.hasCase ? 'is-met' : ''}><Check size={13} aria-hidden="true" />{t.strengthHints[1]}</li>
                        <li className={strength.hasNumber ? 'is-met' : ''}><Check size={13} aria-hidden="true" />{t.strengthHints[2]}</li>
                        <li className={strength.hasSymbolLong ? 'is-met' : ''}><Check size={13} aria-hidden="true" />{t.strengthHints[3]}</li>
                      </ul>
                    </div>
                  )}
                  {fieldErrors.password && <p id={`${passwordId}-error`} className="auth-field-error" role="alert">{fieldErrors.password}</p>}
                </div>
                {view === 'signup' && (
                  <div className="auth-field">
                    <label htmlFor={confirmId}>{t.confirmPasswordLabel}</label>
                    <div className="auth-password-wrap">
                      <input
                        id={confirmId}
                        type={showConfirm ? 'text' : 'password'}
                        name="confirm-password"
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(event) => { setConfirmPassword(event.target.value); setTouched((prev) => ({ ...prev, confirm: true })); }}
                        onBlur={() => validateLive('confirm')}
                        disabled={busy}
                        aria-invalid={Boolean(fieldErrors.confirm)}
                        aria-describedby={fieldErrors.confirm ? `${confirmId}-error` : undefined}
                      />
                      <button
                        type="button"
                        className="auth-password-toggle"
                        onClick={() => setShowConfirm((value) => !value)}
                        disabled={busy}
                        aria-label={showConfirm ? t.hidePassword : t.showPassword}
                        aria-pressed={showConfirm}
                        title={showConfirm ? t.hidePassword : t.showPassword}
                      >
                        {showConfirm ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                      </button>
                    </div>
                    {fieldErrors.confirm && <p id={`${confirmId}-error`} className="auth-field-error" role="alert">{fieldErrors.confirm}</p>}
                  </div>
                )}
                <button className="credential-submit" type="submit" disabled={busy || !formValid}>
                  {busy ? <LoaderCircle size={18} className="spin" aria-hidden="true" /> : <LockKeyhole size={18} aria-hidden="true" />}
                  <span>{busy ? t.loading : view === 'signup' ? t.registerButton : t.signInButton}</span>
                  {!busy && <ArrowRight size={17} aria-hidden="true" />}
                </button>
                <p className="auth-switch-line">
                  {view === 'signup' ? t.haveAccount : t.needAccount}{' '}
                  <button type="button" className="auth-switch-button" disabled={busy} onClick={() => switchView(view === 'signup' ? 'signin' : 'signup')}>
                    {view === 'signup' ? t.switchToSignIn : t.switchToRegister}
                  </button>
                </p>
              </form>
            </>
          )}

          {(providers.password || anyProvider || providers.dev_login) && <div className="auth-divider"><span>{t.or}</span></div>}

          <div className="oauth-buttons">
            <button type="button" disabled={busy || !providers.google} onClick={() => onOAuth('google')}>
              <GoogleMark />
              <span>{t.google}</span>
              {!providers.google && <em>{t.unavailable}</em>}
              {providers.google && <ArrowRight size={17} />}
            </button>
            <button type="button" disabled={busy || !providers.github} onClick={() => onOAuth('github')}>
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
              <button className="dev-login-button" type="button" disabled={busy} onClick={onDevelopmentLogin}>
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
