import {
  Activity,
  ArrowRight,
  ArrowUp,
  BookOpen,
  BookOpenCheck,
  CircleDollarSign,
  Cookie,
  Database,
  FileText,
  Fingerprint,
  History,
  Info,
  LifeBuoy,
  Search,
  Settings2,
  Shapes,
  ShieldCheck,
  Sparkles,
  UserRoundCog,
  UsersRound,
} from 'lucide-react';
import type { InformationView } from './InformationPages';
import type { AppView, Health, Language } from './ProductViews';
import { BrandMark } from './BrandMark';

interface AppFooterProps {
  language: Language;
  health: Health;
  onNavigate: (view: AppView) => void;
  onNavigateInformation: (view: InformationView) => void;
}

const copy = {
  vi: {
    description: 'Workspace đọc nguồn theo câu hỏi, phân tích paper theo lĩnh vực và báo cáo có dẫn chứng truy ngược được.',
    product: 'Sản phẩm & Công cụ', account: 'Tài khoản & Hỗ trợ', legal: 'Pháp lý & Bảo mật',
    research: 'Research workspace', domains: 'Lĩnh vực nghiên cứu', reports: 'Thư viện báo cáo', sources: 'Kho nguồn', settings: 'Cài đặt nghiên cứu', guide: 'Hướng dẫn sử dụng', pricing: 'Bảng giá & license',
    profile: 'Hồ sơ nghiên cứu', accountSettings: 'Cài đặt tài khoản', help: 'Trung tâm trợ giúp', changelog: 'Nhật ký thay đổi', about: 'Về Nexora',
    security: 'Tiêu chuẩn bảo mật', privacy: 'Chính sách quyền riêng tư', terms: 'Điều khoản sử dụng', cookies: 'Cookie preferences', accessibility: 'Khả năng truy cập',
    ctaEyebrow: 'READY FOR A NEW BRIEF?', ctaTitle: 'Biến câu hỏi tiếp theo thành một báo cáo có nguồn.',
    ctaBody: 'Bắt đầu từ một brief rõ ràng hoặc mở Hướng dẫn để xem toàn bộ quy trình nghiên cứu 5 bước.',
    ctaPrimary: 'Bắt đầu nghiên cứu', ctaSecondary: 'Xem hướng dẫn',
    online: 'v0.8.1 · Hệ thống hoạt động', offline: 'v0.8.1 · Backend ngoại tuyến', checking: 'v0.8.1 · Đang kiểm tra',
    copyright: 'Nexora Workspace. Mọi quyền được bảo lưu.',
    stack: 'Shared document cache · Tavily discovery · Evidence review · LangGraph',
    backToTop: 'Về đầu trang', navLabel: 'Điều hướng cuối trang',
  },
  en: {
    description: 'An evidence-first workspace for question-driven reading, field-specific paper analysis, and source-linked reports.',
    product: 'Product & Tools', account: 'Account & Support', legal: 'Legal & Security',
    research: 'Research workspace', domains: 'Research fields', reports: 'Report library', sources: 'Source catalog', settings: 'Research settings', guide: 'Product guide', pricing: 'Pricing & licenses',
    profile: 'Research profile', accountSettings: 'Account settings', help: 'Help center', changelog: 'Changelog', about: 'About Nexora',
    security: 'Security practices', privacy: 'Privacy policy', terms: 'Terms of use', cookies: 'Cookie preferences', accessibility: 'Accessibility',
    ctaEyebrow: 'READY FOR A NEW BRIEF?', ctaTitle: 'Turn your next question into a sourced report.',
    ctaBody: 'Start with a focused brief or open the Guide for the complete five-stage research workflow.',
    ctaPrimary: 'Start research', ctaSecondary: 'Read the guide',
    online: 'v0.8.1 · System operational', offline: 'v0.8.1 · Backend offline', checking: 'v0.8.1 · Checking system',
    copyright: 'Nexora Workspace. All rights reserved.',
    stack: 'Shared document cache · Tavily discovery · Evidence review · LangGraph',
    backToTop: 'Back to top', navLabel: 'Footer navigation',
  },
} as const;

export function AppFooter({ language, health, onNavigate, onNavigateInformation }: AppFooterProps) {
  const t = copy[language];
  const systemLabel = health === 'online' ? t.online : health === 'offline' ? t.offline : t.checking;

  return (
    <footer className="site-footer">
      <section className="site-footer__cta">
        <div><span>{t.ctaEyebrow}</span><h2>{t.ctaTitle}</h2><p>{t.ctaBody}</p></div>
        <div>
          <button className="button button--primary" type="button" onClick={() => onNavigate('research')}><Sparkles size={17} />{t.ctaPrimary}</button>
          <button className="button button--secondary" type="button" onClick={() => onNavigate('guide')}>{t.ctaSecondary}<ArrowRight size={16} /></button>
        </div>
      </section>

      <div className="site-footer__main">
        <section className="site-footer__brand" aria-labelledby="footer-brand-title">
          <div className="site-footer__identity">
            <span><BrandMark size={42} /></span>
            <div><strong id="footer-brand-title">Nexora</strong><small>Evidence-first workspace</small></div>
          </div>
          <p>{t.description}</p>
          <div className={`site-footer__status is-${health}`} role="status"><Activity size={15} /><span>{systemLabel}</span></div>
        </section>

        <nav className="site-footer__columns" aria-label={t.navLabel}>
          <section>
            <h2>{t.product}</h2>
            <button type="button" onClick={() => onNavigate('research')}><Search size={16} />{t.research}</button>
            <button type="button" onClick={() => onNavigate('domains')}><Shapes size={16} />{t.domains}</button>
            <button type="button" onClick={() => onNavigate('reports')}><BookOpen size={16} />{t.reports}</button>
            <button type="button" onClick={() => onNavigate('sources')}><Database size={16} />{t.sources}</button>
            <button type="button" onClick={() => onNavigate('settings')}><Settings2 size={16} />{t.settings}</button>
            <button type="button" onClick={() => onNavigate('guide')}><BookOpenCheck size={16} />{t.guide}</button>
            <button type="button" onClick={() => onNavigate('pricing')}><CircleDollarSign size={16} />{t.pricing}</button>
          </section>
          <section>
            <h2>{t.account}</h2>
            <button type="button" onClick={() => onNavigate('collab')}><UsersRound size={16} />{language === 'vi' ? 'Dự án & nhóm nghiên cứu' : 'Projects & research groups'}</button>
            <button type="button" onClick={() => onNavigate('profile')}><UserRoundCog size={16} />{t.profile}</button>
            <button type="button" onClick={() => onNavigate('settings')}><UserRoundCog size={16} />{t.accountSettings}</button>
            <button type="button" onClick={() => onNavigateInformation('help')}><LifeBuoy size={16} />{t.help}</button>
            <button type="button" onClick={() => onNavigateInformation('changelog')}><History size={16} />{t.changelog}</button>
            <button type="button" onClick={() => onNavigateInformation('about')}><Info size={16} />{t.about}</button>
          </section>
          <section>
            <h2>{t.legal}</h2>
            <a href="#/security" onClick={(event) => { event.preventDefault(); onNavigateInformation('security'); }}><ShieldCheck size={16} />{t.security}</a>
            <a href="#/privacy" onClick={(event) => { event.preventDefault(); onNavigateInformation('privacy'); }}><Fingerprint size={16} />{t.privacy}</a>
            <a href="#/terms" onClick={(event) => { event.preventDefault(); onNavigateInformation('terms'); }}><FileText size={16} />{t.terms}</a>
            <a href="#/cookies" onClick={(event) => { event.preventDefault(); onNavigateInformation('cookies'); }}><Cookie size={16} />{t.cookies}</a>
            <a href="#/accessibility" onClick={(event) => { event.preventDefault(); onNavigateInformation('accessibility'); }}><Info size={16} />{t.accessibility}</a>
          </section>
        </nav>
      </div>

      <div className="site-footer__bottom">
        <span>© {new Date().getFullYear()} {t.copyright}</span>
        <small>{t.stack}</small>
        <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>{t.backToTop}<ArrowUp size={15} /></button>
      </div>
    </footer>
  );
}
