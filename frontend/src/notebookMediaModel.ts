export function safeNotebookURL(value: string): string {
  if (!value || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) return '';
  try { const url = new URL(value.trim()); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && url.hostname ? url.href : ''; } catch { return ''; }
}
// Percentages keep the saved size useful on both a wide editor and a phone.
export function notebookImageWidth(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.min(100, Math.max(25, value))) : 100;
}
export function resizedNotebookImageWidth(initial: number, deltaX: number, containerWidth: number): number {
  return notebookImageWidth(containerWidth > 0 ? initial + deltaX * 200 / containerWidth : initial);
}
export function notebookMediaError(code: string, vi: boolean): string {
  const messages: Record<string, [string, string]> = {
    notebook_image_size: ['Ảnh phải có nội dung và nhỏ hơn 10 MB.', 'Use a nonempty image smaller than 10 MB.'],
    notebook_image_invalid: ['Chọn ảnh PNG, JPEG hoặc WebP tĩnh hợp lệ, tối đa 20 megapixel.', 'Choose a valid static PNG, JPEG or WebP image, up to 20 megapixels.'],
    notebook_image_quota: ['Đã đạt giới hạn 100 MB ảnh của tài khoản.', 'This account has reached its 100 MB image limit.'],
    notebook_image_rate: ['Bạn đã thêm nhiều ảnh. Vui lòng chờ rồi thử lại.', 'Too many new images. Please wait before trying again.'],
    notebook_image_busy: ['Hệ thống đang xử lý ảnh khác. Vui lòng thử lại.', 'Image processing is busy. Please try again.'],
    notebook_image_url_failed: ['Không nhập được ảnh từ URL công khai này. Thử tải ảnh về rồi dán hoặc chọn tệp; địa chỉ nội bộ, HTML và SVG không được nhận.', 'Could not import an image from this public URL. Download and paste/upload it instead; private addresses, HTML and SVG are not supported.'],
    notebook_url_invalid: ['Nhập URL http/https hợp lệ, không kèm tài khoản hoặc mật khẩu.', 'Enter a valid HTTP(S) URL without a username or password.'],
    notebook_image_count: ['Thêm tối đa 3 ảnh mỗi lần.', 'Add up to 3 images at a time.'],
  };
  return messages[code]?.[vi ? 0 : 1] || (vi ? 'Chưa thêm được nội dung. Trang hiện tại vẫn được giữ; hãy kiểm tra kết nối và quyền chỉnh sửa.' : 'Content could not be added. Your page is preserved; check the connection and editing access.');
}
