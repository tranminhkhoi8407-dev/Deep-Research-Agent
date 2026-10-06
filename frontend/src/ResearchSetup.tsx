import { useEffect, useRef, useState } from 'react';
import type { Language, ResearchDepth } from './ProductViews';
import './ResearchEvidence.css';

export interface ResearchOptions {
  reportLanguage: 'auto' | 'vi' | 'en';
  mode: 'research' | 'paper';
  paperInput: string;
  documentId: string;
  documentName: string;
  field: string;
  detail: 'concise' | 'detailed' | 'extended';
  preferredReportLanguage: 'vi' | 'en';
  budget?: { max_searches: number; max_documents: number };
}
export const defaultResearchOptions: ResearchOptions = {
  reportLanguage: 'auto', mode: 'research', paperInput: '', documentId: '', documentName: '', field: 'auto', detail: 'detailed', preferredReportLanguage: 'vi',
};

export function initialResearchOptions(): ResearchOptions {
  try {
    const saved = JSON.parse(localStorage.getItem('nexora-report-preferences-v1') || '{}');
    return { ...defaultResearchOptions,
      reportLanguage: ['auto', 'vi', 'en'].includes(saved.reportLanguage) ? saved.reportLanguage : 'auto',
      preferredReportLanguage: saved.preferredReportLanguage === 'en' ? 'en' : 'vi',
      detail: ['concise', 'detailed', 'extended'].includes(saved.detail) ? saved.detail : 'detailed',
    };
  } catch { return { ...defaultResearchOptions }; }
}

export function ResearchSetup({ language, apiBase, depth, busy, value, onChange, onUploading }: {
  language: Language; apiBase: string; depth: ResearchDepth; busy: boolean; value: ResearchOptions;
  onChange: (value: ResearchOptions) => void; onUploading: (value: boolean) => void;
}) {
  const vi = language === 'vi';
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const uploadController = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; uploadController.current?.abort(); onUploading(false); };
  }, [onUploading]);
  const defaults = { quick: [2, 3, 4], standard: [6, 8, 6], deep: [10, 12, 8] }[depth];
  const upload = async (file?: File) => {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { setError(vi ? 'PDF tối đa 20 MB.' : 'PDF limit is 20 MB.'); return; }
    setUploading(true); onUploading(true); setError(''); setWarning('');
    const controller = new AbortController();
    uploadController.current = controller;
    try {
      const response = await fetch(apiBase + '/api/research/documents', {
        method: 'POST', credentials: 'include', signal: controller.signal,
        headers: { 'Content-Type': 'application/pdf', 'X-Document-Name': encodeURIComponent(file.name) }, body: file,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'PDF upload failed');
      if (!mounted.current || controller.signal.aborted) return;
      onChange({ ...value, documentId: result.id, documentName: file.name, paperInput: '' });
      setWarning((vi ? 'Đã trích xuất ' : 'Extracted ') + result.page_count + (vi ? ' trang. Bảng, công thức và hình cần đối chiếu PDF; chưa hỗ trợ OCR.' : ' pages. Verify tables, formulas and figures against the PDF; OCR is not supported.') + (result.truncated ? ' Reading limits applied.' : ''));
    } catch (reason) { if (mounted.current && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'PDF upload failed'); }
    finally { if (mounted.current) { setUploading(false); onUploading(false); } uploadController.current = null; }
  };
  return <section className="research-setup" aria-label={vi ? 'Thiết lập báo cáo và tài liệu' : 'Report and document settings'}>
    <div className="research-setup__grid">
      <label>{vi ? 'Ngôn ngữ báo cáo' : 'Report language'}
        <select disabled={busy || uploading} value={value.reportLanguage} onChange={event => onChange({ ...value, reportLanguage: event.target.value as ResearchOptions['reportLanguage'], preferredReportLanguage: event.target.value === 'auto' ? value.preferredReportLanguage : event.target.value as 'vi' | 'en' })}>
          <option value="auto">{vi ? 'Auto · theo yêu cầu trong prompt' : 'Auto · follow the prompt'}</option><option value="vi">Tiếng Việt</option><option value="en">English</option>
        </select>
      </label>
      <label>{vi ? 'Loại phân tích' : 'Analysis mode'}
        <select disabled={busy || uploading} value={value.mode} onChange={event => onChange({ ...value, mode: event.target.value as ResearchOptions['mode'] })}>
          <option value="research">{vi ? 'Nghiên cứu / hướng dẫn kỹ thuật' : 'Research / technical guide'}</option><option value="paper">{vi ? 'Phân tích paper theo lĩnh vực' : 'Field-specific paper analysis'}</option>
        </select>
      </label>
    </div>
    <small>{vi ? 'VIE/ENG chỉ đổi giao diện. Đọc nguồn gốc, viết theo ngôn ngữ báo cáo; không dịch toàn bộ tài liệu trước.' : 'VIE/ENG changes only the interface. Read originals and write in the report language, without translating every document first.'}</small>
    <div className="research-setup__grid">
      <label>{vi ? 'Mức chi tiết' : 'Explanation depth'}<select disabled={busy || uploading} value={value.detail} onChange={event => onChange({ ...value, detail: event.target.value as ResearchOptions['detail'] })}>
        <option value="concise">{vi ? 'Gọn · mục tiêu 500–1.000 từ' : 'Concise · target 500–1,000 words'}</option>
        <option value="detailed">{vi ? 'Chi tiết · mục tiêu 1.500–2.500 từ' : 'Detailed · target 1,500–2,500 words'}</option>
        <option value="extended">{vi ? 'Chuyên sâu · mục tiêu 3.000–5.000 từ' : 'Extended · target 3,000–5,000 words'}</option>
      </select></label>
      {value.reportLanguage === 'auto' && <label>{vi ? 'Ngôn ngữ khi không có prompt' : 'Language without a prompt'}<select disabled={busy || uploading} value={value.preferredReportLanguage} onChange={event => onChange({ ...value, preferredReportLanguage: event.target.value as 'vi' | 'en' })}><option value="vi">Tiếng Việt</option><option value="en">English</option></select></label>}
    </div>
    <small>{vi ? 'Độ dài là mục tiêu, không phải bảo đảm. Không kéo dài bằng nội dung thiếu bằng chứng. Xuất PDF và mã LaTeX đầy đủ từ cùng bản phân tích đã kiểm tra.' : 'Length is a target, not a guarantee. No padding with unsupported content. PDF and complete LaTeX source use the same checked analysis.'}</small>
    {depth === 'quick' && value.detail !== 'concise' && <small>{vi ? 'Quick có ngân sách nhỏ: để phân tích dài và sâu, nên chọn Standard hoặc Deep.' : 'Quick has a small budget: choose Standard or Deep for longer, deeper explanations.'}</small>}
    {value.mode === 'paper' && <div className="research-setup__paper">
      <label>{vi ? 'Lĩnh vực phân tích' : 'Analysis discipline'}<select value={value.field} disabled={busy || uploading} onChange={event => onChange({ ...value, field: event.target.value })}>
        {[['auto', vi ? 'Tự nhận diện từ paper' : 'Detect from paper'], ['general', vi ? 'Tự do / liên ngành' : 'General / interdisciplinary'], ['mathematics', 'Mathematics'], ['physics', 'Physics'], ['chemistry', 'Chemistry'], ['biology', 'Biology'], ['artificial-intelligence', 'AI']].map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select></label>
      <label>{vi ? 'Link PDF, arXiv ID hoặc DOI' : 'PDF URL, arXiv ID or DOI'}<input value={value.paperInput} disabled={busy || uploading} maxLength={2000} placeholder="https://arxiv.org/abs/2605.03465v1" onChange={event => onChange({ ...value, paperInput: event.target.value, documentId: '', documentName: '' })} /></label>
      <label className="research-upload">{uploading ? (vi ? 'Đang đọc PDF…' : 'Reading PDF…') : value.documentName || (vi ? 'Hoặc tải PDF riêng tư · tối đa 20 MB' : 'Or upload a private PDF · up to 20 MB')}
        <input type="file" accept="application/pdf,.pdf" disabled={busy || uploading} onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }} />
      </label>
      {value.documentId && <button type="button" disabled={busy || uploading} onClick={() => { onChange({ ...value, documentId: '', documentName: '' }); setWarning(''); }}>{vi ? 'Bỏ chọn PDF' : 'Unselect PDF'}</button>}
      <small>{vi ? 'PDF lưu riêng theo tài khoản; đoạn được chọn sẽ gửi tới nhà cung cấp model đã cấu hình để phân tích. Không tự gửi PDF sang arXivisual. Abstract chỉ đủ cho phân tích sơ bộ.' : 'PDF storage is account-isolated; selected excerpts go to your configured model provider for analysis. PDFs are not sent to arXivisual. Abstract-only access allows preliminary analysis only.'}</small>
    </div>}
    <details className="research-setup__budget"><summary>{vi ? 'Ngân sách và điểm dừng' : 'Budget and stopping limits'}</summary>
      <p>{vi ? 'Tối đa' : 'Up to'} {value.budget?.max_searches ?? defaults[0]} {vi ? 'lượt tìm' : 'searches'} · {value.budget?.max_documents ?? defaults[1]} {vi ? 'lần đọc tài liệu' : 'document attempts'} · {defaults[2]} {vi ? 'lượt gọi model' : 'model calls'}.</p>
      <p>{vi ? 'Trần token đầu vào / đầu ra' : 'Input / output token ceilings'}: {({ quick: '18.000 / 8.000', standard: '60.000 / 24.000', deep: '100.000 / 30.000' })[depth]}. {vi ? 'Không phải mức dùng cố định; phân tích chuyên sâu có thể tốn hơn.' : 'Not fixed usage; deeper analysis can cost more.'}</p>
      <div className="research-setup__grid">
        <label>{vi ? 'Giới hạn lượt tìm' : 'Search limit'}<input type="number" min={0} max={16} disabled={busy || uploading} value={value.budget?.max_searches ?? defaults[0]} onChange={event => onChange({ ...value, budget: { max_searches: Math.min(16, Math.max(0, Number(event.target.value))), max_documents: value.budget?.max_documents ?? defaults[1] } })} /></label>
        <label>{vi ? 'Giới hạn tài liệu' : 'Document limit'}<input type="number" min={1} max={20} disabled={busy || uploading} value={value.budget?.max_documents ?? defaults[1]} onChange={event => onChange({ ...value, budget: { max_documents: Math.min(20, Math.max(1, Number(event.target.value))), max_searches: value.budget?.max_searches ?? defaults[0] } })} /></label>
      </div>
      <small>{vi ? 'Token đầu vào được ước tính; token đầu ra có giới hạn từng lần gọi. Đây không phải cam kết giá. Hết ngân sách thì báo thiếu bằng chứng, không viết cho đủ độ dài.' : 'Input tokens are estimated; output is capped per call. This is not a price guarantee. Budget exhaustion is disclosed, never padded with invented evidence.'}</small>
    </details>
    {error && <p role="alert" className="research-evidence__warning">{error}</p>}
    {warning && <p role="status">{warning}</p>}
  </section>;
}
