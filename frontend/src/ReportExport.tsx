import { useEffect, useRef, useState } from 'react';
import { downloadReportArtifact, type ReportFormat } from './reportExports';

export function ReportExport({ apiBase, reportId, vi }: { apiBase: string; reportId: string; vi: boolean }) {
  const [busy, setBusy] = useState<ReportFormat | null>(null);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    setBusy(null); setError('');
    return () => controller.current?.abort();
  }, [reportId]);
  const download = async (format: ReportFormat) => {
    const next = new AbortController();
    controller.current = next;
    setBusy(format); setError('');
    try { await downloadReportArtifact(apiBase, reportId, format, next.signal); }
    catch (reason) { if (!next.signal.aborted) setError(reason instanceof Error ? reason.message : 'Export failed'); }
    finally { if (!next.signal.aborted) setBusy(null); }
  };
  return <div className="research-export">
    <div>{(['pdf', 'tex', 'zip'] as const).map(format => <button type="button" key={format} disabled={!!busy} onClick={() => void download(format)}>{busy === format ? (vi ? 'Đang tạo…' : 'Preparing…') : format === 'pdf' ? (vi ? 'Tải PDF' : 'Download PDF') : format === 'tex' ? 'LaTeX .tex' : (vi ? 'Gói nguồn .zip' : 'Source bundle .zip')}</button>)}</div>
    <small>{vi ? 'PDF và LaTeX chứa cùng nội dung đã kiểm tra. Biên dịch trên máy chủ; không gửi PDF riêng tư sang dịch vụ ngoài.' : 'PDF and LaTeX contain the same checked content. Compiled on the server; private PDFs are not sent to an external export service.'}</small>
    {error && <p role="alert" className="research-evidence__warning">{error} · {vi ? 'Bạn vẫn có thể tải mã LaTeX nếu PDF chưa biên dịch được.' : 'LaTeX source remains available if PDF compilation fails.'}</p>}
  </div>;
}
