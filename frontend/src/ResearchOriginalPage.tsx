import { useEffect, useState } from 'react';
import { originalPageUrl } from './researchVisualModel';

interface Location { matched: boolean; page_count: number; rectangles: { x: number; y: number; width: number; height: number }[] }
/** Opt-in owner-scoped raster preview: no embedded PDF scripts or external viewer. */
export function ResearchOriginalPage({ apiBase, documentId, page, quote, vi }: { apiBase: string; documentId: string; page: number; quote: string; vi: boolean }) {
  const [opened, setOpened] = useState(false), [current, setCurrent] = useState(page), [zoom, setZoom] = useState(100);
  const [imageUrl, setImageUrl] = useState(''), [location, setLocation] = useState<Location | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [highlight, setHighlight] = useState(true);
  useEffect(() => {
    if (!opened) return;
    const controller = new AbortController();
    let url = '';
    setBusy(true); setError(''); setImageUrl(''); setLocation(null);
    const image = originalPageUrl(apiBase, documentId, current, 'image');
    const locate = originalPageUrl(apiBase, documentId, current, 'locate');
    if (!image || !locate) { setError(vi ? 'Vị trí PDF không hợp lệ.' : 'Invalid PDF location.'); setBusy(false); return; }
    void (async () => {
      try {
        const response = await fetch(image, { credentials: 'include', signal: controller.signal });
        if (!response.ok || !response.headers.get('content-type')?.startsWith('image/png')) throw new Error('preview');
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob); setImageUrl(url);
        const matched = await fetch(locate, { method: 'POST', credentials: 'include', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quote }) });
        if (matched.ok) {
          const payload = await matched.json() as Location;
          if (!controller.signal.aborted) setLocation(payload);
        }
      } catch {
        if (!controller.signal.aborted) setError(vi ? 'Không mở được trang PDF. Có thể phiên đăng nhập hết hạn, PDF không còn trong kho hoặc dịch vụ đang bận. Bạn có thể mở nguồn gốc hoặc thử lại.' : 'PDF preview unavailable. Your session may have expired, the original may be missing or the service may be busy. Open the source or retry.');
      } finally { if (!controller.signal.aborted) setBusy(false); }
    })();
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [opened, current, apiBase, documentId, quote, vi]);
  return <div className="research-original">
    <button type="button" aria-expanded={opened} onClick={() => setOpened(!opened)}>{opened ? (vi ? 'Đóng trang PDF' : 'Close PDF page') : (vi ? 'Xem trang PDF & hình gốc ngay tại đây' : 'View original PDF page & figures here')}</button>
    {opened && <>
      <div className="research-original__controls"><button type="button" disabled={busy || current <= 1} onClick={() => setCurrent(current - 1)} aria-label={vi ? 'Trang PDF trước' : 'Previous PDF page'}>←</button><span>{vi ? 'Trang' : 'Page'} {current}{location && ` / ${location.page_count}`}</span><button type="button" disabled={busy || !location || current >= Math.min(location.page_count, 100)} onClick={() => setCurrent(current + 1)} aria-label={vi ? 'Trang PDF tiếp theo' : 'Next PDF page'}>→</button><label>{vi ? 'Phóng to' : 'Zoom'}<select value={zoom} onChange={event => setZoom(Number(event.target.value))}>{[100, 150, 200].map(value => <option value={value} key={value}>{value}%</option>)}</select></label><label><input type="checkbox" checked={highlight} onChange={event => setHighlight(event.target.checked)} />{vi ? 'Đánh dấu trích đoạn' : 'Highlight excerpt'}</label></div>
      {busy && <p role="status">{vi ? 'Đang mở trang gốc…' : 'Loading original page…'}</p>}
      {error && <p role="alert">{error}</p>}
      {imageUrl && <div className="research-original__scroll"><div className="research-original__page" style={{ width: `${zoom}%` }}><img src={imageUrl} alt={vi ? `Trang ${current} từ PDF gốc, bao gồm hình và bảng nếu có` : `Original PDF page ${current}, including any figures and tables`} />{highlight && location?.rectangles.map((rect, index) => <span aria-hidden="true" key={index} style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }} />)}</div></div>}
      {imageUrl && !busy && <small>{location?.matched ? (vi ? 'Vùng được đánh dấu là vị trí tìm thấy trích đoạn trong PDF, không phải xác minh nội dung hay chú thích AI cho hình.' : 'Highlighted regions locate the quote in the PDF, not verification or AI figure annotation.') : (vi ? 'Không xác định được vị trí trích đoạn trên trang này; không vẽ vùng gần đúng. Hãy đối chiếu chữ, công thức và hình gốc.' : 'The excerpt could not be located on this page; no approximate highlight is drawn. Inspect the original text, formulas and figures.')}</small>}
      <small>{vi ? 'Trang được hiển thị từ kho tài liệu của tài khoản. Không gửi PDF sang dịch vụ bên ngoài.' : 'Displayed from your account’s stored document. No PDF is sent to an external service.'}</small>
    </>}
  </div>;
}
