import { ArrowRight, Atom, BookOpenCheck, Dna, FileText, FlaskConical, Sigma, type LucideIcon } from 'lucide-react';
import type { Language } from './ProductViews';
import { scholarlyFields, type ScholarlyFieldId } from './ScholarlyCatalog';

const icons: Record<ScholarlyFieldId, LucideIcon> = {
  mathematics: Sigma,
  physics: Atom,
  chemistry: FlaskConical,
  biology: Dna,
  'artificial-intelligence': BookOpenCheck,
};

interface Props {
  language: Language;
  reportCount: number;
  onSelectField: (id: ScholarlyFieldId) => void;
  onReports: () => void;
}

export function LibraryLanding({ language, reportCount, onSelectField, onReports }: Props) {
  const vi = language === 'vi';
  return <div className="scholarly-landing">
    <header className="scholarly-landing__hero" data-tour="library-hero">
      <div>
        <span className="eyebrow">{vi ? 'THƯ VIỆN NGHIÊN CỨU' : 'RESEARCH LIBRARY'}</span>
        <h1>{vi ? 'Khám phá theo lĩnh vực.' : 'Explore by discipline.'}</h1>
        <p>{vi ? 'Chọn một lĩnh vực để tìm công trình mới, duyệt tạp chí, lưu bài và ghi chú. Báo cáo do bạn tạo được giữ riêng trong thư viện cá nhân.' : 'Choose a field to discover papers, browse journals, save reading and take notes. Your own research reports live in a separate personal library.'}</p>
      </div>
      <div className="scholarly-landing__hero-mark" aria-hidden="true"><BookOpenCheck size={62} strokeWidth={1.3} /></div>
    </header>

    <div className="scholarly-landing__intro"><div><span className="eyebrow">{vi ? '05 LĨNH VỰC' : '05 DISCIPLINES'}</span><h2>{vi ? 'Bạn muốn nghiên cứu gì hôm nay?' : 'What would you like to study?'}</h2></div><p>{vi ? 'Mỗi lĩnh vực có danh mục arXiv và bộ tạp chí riêng.' : 'Each field has its own arXiv topics and curated journal shortcuts.'}</p></div>
    <div className="scholarly-landing__grid" data-tour="library-fields">
      {scholarlyFields.map((field) => {
        const Icon = icons[field.id];
        const content = field[language];
        return <button key={field.id} type="button" className={`scholarly-field scholarly-field--${field.id}`} onClick={() => onSelectField(field.id)} aria-label={`${vi ? 'Mở thư viện' : 'Open library'}: ${content.title}`}>
          <span className="scholarly-field__top"><span className="scholarly-field__icon"><Icon size={27} strokeWidth={1.8} /></span><span className="scholarly-field__code">{field.code}</span></span>
          <strong>{content.title}</strong><span className="scholarly-field__subtitle">{content.subtitle}</span><p>{content.description}</p>
          <span className="scholarly-field__meta"><span>{field.categories.length} {vi ? 'chủ đề' : 'topics'}</span><span>{field.journals.length} {vi ? 'tạp chí' : 'journals'}</span></span>
          <span className="scholarly-field__action">{vi ? 'Khám phá lĩnh vực' : 'Explore field'}<ArrowRight size={18} /></span>
        </button>;
      })}
    </div>

    <section className="scholarly-landing__reports" data-tour="library-reports">
      <span className="scholarly-landing__report-icon"><FileText size={25} /></span>
      <div><span className="eyebrow">{vi ? 'KHÔNG GIAN CỦA BẠN' : 'YOUR WORKSPACE'}</span><h2>{vi ? 'Báo cáo nghiên cứu của tôi' : 'My research reports'}</h2><p>{vi ? `${reportCount} báo cáo đã lưu. Xem lại, tải xuống hoặc tiếp tục từ kết quả trước.` : `${reportCount} saved reports. Revisit, download, or continue from previous work.`}</p></div>
      <button className="button button--secondary" type="button" onClick={onReports}>{vi ? 'Mở báo cáo' : 'Open reports'}<ArrowRight size={17} /></button>
    </section>
    <p className="scholarly-landing__disclaimer" data-tour="library-provenance">{vi ? 'Metadata từ arXiv và Crossref. Tên tạp chí là lối tắt khám phá, không bảo đảm quyền truy cập toàn văn hoặc chất lượng của từng bài.' : 'Metadata from arXiv and Crossref. Journal shortcuts do not guarantee full-text access or the quality of individual articles.'}</p>
  </div>;
}
