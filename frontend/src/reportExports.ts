export type ReportFormat = 'pdf' | 'tex' | 'zip';

export function reportExportUrl(apiBase: string, reportId: string, format: ReportFormat): string {
  return apiBase + '/api/reports/' + encodeURIComponent(reportId) + '/export?format=' + format;
}

export async function fetchReportArtifact(apiBase: string, reportId: string, format: ReportFormat, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch(reportExportUrl(apiBase, reportId, format), { credentials: 'include', signal });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.detail === 'string' ? body.detail : body.detail?.message || 'Report export failed');
  }
  const blob = await response.blob();
  const mime = blob.type.split(';')[0];
  const expected = { pdf: ['application/pdf'], tex: ['application/x-tex', 'text/plain'], zip: ['application/zip'] };
  if (!expected[format].includes(mime) || blob.size === 0) throw new Error('The server did not return the requested report artifact');
  if (format === 'pdf' && await blob.slice(0, 5).text() !== '%PDF-') throw new Error('The server did not return a valid PDF');
  return blob;
}

export async function downloadReportArtifact(apiBase: string, reportId: string, format: ReportFormat, signal?: AbortSignal): Promise<void> {
  const blob = await fetchReportArtifact(apiBase, reportId, format, signal);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = reportId.replace(/\.md$/i, '') + (format === 'zip' ? '.source.zip' : '.' + format);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function arxivisualUrl(value: string): string | null {
  let id = value.trim();
  if (/^https?:\/\//i.test(id)) {
    try {
      const url = new URL(id);
      if (!['arxiv.org', 'www.arxiv.org'].includes(url.hostname) || url.username || url.password || url.search || url.hash) return null;
      id = url.pathname.replace(/^\/(abs|pdf)\//, '').replace(/\.pdf$/i, '');
    } catch { return null; }
  }
  return /^\d{4}\.\d{4,5}(v\d+)?$/.test(id) ? 'https://www.arxivisual.org/abs/' + id : null;
}
