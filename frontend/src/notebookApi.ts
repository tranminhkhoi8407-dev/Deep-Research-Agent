export class NotebookApiError extends Error {
  constructor(public status: number, public detail: string) { super(detail); }
}
export async function notebookApi<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}/api/collab${path}`, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new NotebookApiError(response.status, typeof result.detail === 'string' ? result.detail : `Request failed (${response.status})`);
  return result;
}
export function notebookError(reason: unknown, vi: boolean) {
  if (reason instanceof NotebookApiError && reason.status === 404 && reason.detail === 'Not Found') {
    return vi ? 'Máy chủ chưa có phiên bản mới của công cụ trang. Hãy khởi động lại máy chủ rồi thử lại.' : 'The server needs the new page tools. Restart the backend, then retry.';
  }
  return reason instanceof Error ? reason.message : String(reason);
}
