import { createContext, useContext, useEffect, useRef, useState, type DragEvent, type PointerEvent } from 'react';
import type { BlockNoteEditor } from '@blocknote/core';
import { SideMenuExtension } from '@blocknote/core/extensions';
import { createReactBlockSpec } from '@blocknote/react';
import { ArrowUpRight, ImagePlus, Link2, LoaderCircle, Upload, X } from 'lucide-react';
import { notebookImageWidth, notebookMediaError, resizedNotebookImageWidth, safeNotebookURL } from './notebookMediaModel';
import './NotebookMedia.css';

export const NotebookMediaContext = createContext<{ vi: boolean; editable: boolean; imageURL: (id: string) => string; onPreview?: (url: string, name: string) => void }>({ vi: false, editable: false, imageURL: () => '' });
function mediaBlockDrag(editor: BlockNoteEditor<any, any, any>, id: string, editable: boolean) {
  return {
    draggable: editable,
    onDragStartCapture: (event: DragEvent<HTMLElement>) => {
      const block = editor.getBlock(id), sideMenu = editor.getExtension(SideMenuExtension);
      if (!editable || !editor.isEditable || !block || !sideMenu || !event.dataTransfer || (event.target as HTMLElement).closest('input,textarea,select,[data-media-no-drag]')) { event.preventDefault(); return; }
      // Native img/anchor drags serialize an external URL, not the selected
      // notebook block. Use the same selection/payload as the six-dot handle.
      sideMenu.blockDragStart(event, block);
      const view = editor.prosemirrorView;
      view.dragging = { slice: view.state.selection.content(), move: true };
      // Keep bubbling: BlockNote's document-level drag bookkeeping must see
      // the source, or it will treat a move as an import and rewrite block IDs.
    },
    onDragEnd: () => editor.getExtension(SideMenuExtension)?.blockDragEnd(),
  };
}
export const notebookImageSpec = createReactBlockSpec({ type: 'notebookImage', propSchema: { assetId: { default: '' }, name: { default: '' }, caption: { default: '' }, widthPercent: { default: 100 } }, content: 'none' }, {
  render: ({ block, editor }) => {
    const context = useContext(NotebookMediaContext), [failed, setFailed] = useState(false);
    const figure = useRef<HTMLElement>(null), resizing = useRef<{ pointer: number; x: number; initial: number; container: number; width: number } | null>(null);
    const [draftWidth, setDraftWidth] = useState<number | null>(null);
    const editable = context.editable && editor.isEditable, savedWidth = notebookImageWidth(block.props.widthPercent), width = draftWidth ?? savedWidth;
    const cancelResize = () => { resizing.current = null; setDraftWidth(null); };
    useEffect(cancelResize, [block.props.widthPercent, editable]);
    const saveWidth = (value: number) => {
      const current = editor.getBlock(block.id);
      if (context.editable && editor.isEditable && current?.type === 'notebookImage') editor.updateBlock(current, { props: { widthPercent: notebookImageWidth(value) } });
    };
    const beginResize = (event: PointerEvent<HTMLButtonElement>) => {
      if (!editable || event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      const container = figure.current?.parentElement?.getBoundingClientRect().width || 0;
      if (!container) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      resizing.current = { pointer: event.pointerId, x: event.clientX, initial: savedWidth, container, width: savedWidth }; setDraftWidth(savedWidth);
    };
    const url = /^[a-f0-9]{32}$/.test(block.props.assetId) ? context.imageURL(block.props.assetId) : '';
    useEffect(() => setFailed(false), [url]);
    return <figure ref={figure} className={`notebook-media-image${draftWidth !== null ? ' is-resizing' : ''}`} style={{ width: `${width}%` }} contentEditable={false} {...mediaBlockDrag(editor, block.id, editable)}>
      {url && !failed ? <button type="button" draggable={false} className="notebook-media-image__preview" aria-label={(context.vi ? 'Xem ảnh: ' : 'Preview image: ') + (block.props.caption || block.props.name)} onClick={() => context.onPreview?.(url, block.props.caption || block.props.name)}><img draggable={false} src={url} alt={block.props.caption || block.props.name} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /></button> : <p role="status">{context.vi ? 'Không tải được ảnh hoặc quyền xem ảnh đã thay đổi.' : 'Image unavailable or viewing access has changed.'}</p>}
      {editable && <><div className="notebook-media-image__controls" data-media-no-drag><label><span>{context.vi ? 'Kích thước' : 'Size'}</span><select aria-label={context.vi ? 'Kích thước ảnh' : 'Image size'} value={savedWidth} onChange={event => saveWidth(Number(event.target.value))}>{![25, 50, 75, 100].includes(savedWidth) && <option value={savedWidth}>{savedWidth}%</option>}{[25, 50, 75, 100].map(size => <option key={size} value={size}>{size}%</option>)}</select></label></div>
        <button type="button" className="notebook-media-resize" data-media-no-drag draggable={false} role="slider" aria-label={context.vi ? 'Điều chỉnh chiều rộng ảnh' : 'Resize image width'} aria-valuemin={25} aria-valuemax={100} aria-valuenow={width} aria-valuetext={`${width}%`} aria-orientation="horizontal" title={context.vi ? 'Kéo để đổi kích thước · phím mũi tên để tinh chỉnh' : 'Drag to resize · arrow keys to fine-tune'} onPointerDown={beginResize} onPointerMove={event => { const active = resizing.current; if (!active || active.pointer !== event.pointerId) return; active.width = resizedNotebookImageWidth(active.initial, event.clientX - active.x, active.container); setDraftWidth(active.width); }} onPointerUp={event => { const active = resizing.current; if (!active || active.pointer !== event.pointerId) return; cancelResize(); saveWidth(active.width); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={cancelResize} onLostPointerCapture={cancelResize} onKeyDown={event => { const next = event.key === 'Home' ? 25 : event.key === 'End' ? 100 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? savedWidth - (event.shiftKey ? 10 : 1) : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? savedWidth + (event.shiftKey ? 10 : 1) : null; if (next !== null) { event.preventDefault(); event.stopPropagation(); saveWidth(next); } }}><span /></button></>}
      {editable ? <input className="notebook-media-caption" aria-label={context.vi ? 'Chú thích ảnh' : 'Image caption'} placeholder={context.vi ? 'Thêm chú thích…' : 'Add a caption…'} value={block.props.caption} maxLength={500} onChange={event => { if (context.editable && editor.isEditable) editor.updateBlock(block, { props: { caption: event.target.value } }); }} /> : block.props.caption && <figcaption>{block.props.caption}</figcaption>}
    </figure>;
  },
  toExternalHTML: ({ block }) => <figure style={{ width: `${notebookImageWidth(block.props.widthPercent)}%`, margin: '10px auto' }}><img style={{ width: '100%', height: 'auto' }} src={/^[a-f0-9]{32}$/.test(block.props.assetId) ? `/api/collab/images/${block.props.assetId}` : undefined} alt={block.props.caption || block.props.name} />{block.props.caption && <figcaption>{block.props.caption}</figcaption>}</figure>,
})();
export const notebookURLSpec = createReactBlockSpec({ type: 'webLink', propSchema: { url: { default: '' }, title: { default: '' } }, content: 'none' }, {
  render: ({ block, editor }) => {
    const context = useContext(NotebookMediaContext);
    const url = safeNotebookURL(block.props.url);
    return url ? <div className="notebook-url-block" contentEditable={false} {...mediaBlockDrag(editor, block.id, context.editable && editor.isEditable)}><a draggable={false} className="notebook-url-card" href={url} target="_blank" rel="noopener noreferrer"><span className="notebook-url-card__icon"><Link2 size={20} /></span><span><strong>{block.props.title || new URL(url).hostname}</strong><small>{url}</small></span><ArrowUpRight size={18} /></a></div> : <span>Invalid web link</span>;
  },
  toExternalHTML: ({ block }) => <p><a href={safeNotebookURL(block.props.url) || undefined}>{block.props.title || block.props.url}</a></p>,
})();

export function NotebookMediaDialog({ mode, vi, busy, error, onFiles, onImageURL, onLink, onClose }: {
  mode: 'image' | 'link'; vi: boolean; busy: boolean; error: string; onFiles: (files: File[]) => void; onImageURL: (url: string) => void; onLink: (url: string, title: string) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null), opener = useRef(document.activeElement);
  const [tab, setTab] = useState(mode), [url, setURL] = useState(''), [title, setTitle] = useState('');
  useEffect(() => { dialog.current?.showModal(); return () => { if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus(); }; }, []);
  return <dialog ref={dialog} className="notebook-media-dialog" aria-labelledby="notebook-media-title" onCancel={onClose}><header><h2 id="notebook-media-title">{vi ? 'Thêm ảnh hoặc liên kết' : 'Add image or link'}</h2><button type="button" aria-label={vi ? 'Đóng' : 'Close'} onClick={onClose}><X size={19} /></button></header><div className="notebook-media-tabs"><button type="button" aria-pressed={tab === 'image'} disabled={busy} onClick={() => { setTab('image'); setURL(''); }}><ImagePlus size={17} />{vi ? 'Ảnh' : 'Image'}</button><button type="button" aria-pressed={tab === 'link'} disabled={busy} onClick={() => { setTab('link'); setURL(''); }}><Link2 size={17} />{vi ? 'Liên kết' : 'Link'}</button></div>
    {tab === 'image' && <><button type="button" className="notebook-media-upload" disabled={busy} onClick={() => input.current?.click()}><Upload size={21} /><strong>{vi ? 'Chọn ảnh từ máy' : 'Choose images'}</strong><small>PNG / JPEG / WebP · 10 MB</small></button><input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={event => { onFiles(Array.from(event.target.files || [])); event.target.value = ''; }} /><p>{vi ? 'Bạn cũng có thể Ctrl+V hoặc kéo ảnh vào editor. Ảnh được lưu theo quyền của trang, không tạo link công khai.' : 'You can also paste or drop images into the editor. Images follow page permissions; no public link is created.'}</p></>}
    <form onSubmit={event => { event.preventDefault(); const safe = safeNotebookURL(url); if (safe && !busy) { if (tab === 'image') onImageURL(safe); else onLink(safe, title.trim()); } }}><label>{tab === 'image' ? vi ? 'Hoặc nhập URL ảnh công khai' : 'Or enter a public image URL' : vi ? 'URL liên kết' : 'Link URL'}<input autoFocus type="url" value={url} maxLength={2048} disabled={busy} placeholder="https://…" onChange={event => setURL(event.target.value)} /></label>{tab === 'link' && <label>{vi ? 'Tên hiển thị (không bắt buộc)' : 'Display title (optional)'}<input value={title} maxLength={200} disabled={busy} onChange={event => setTitle(event.target.value)} /></label>}<button type="submit" disabled={busy || !safeNotebookURL(url)}>{busy ? <LoaderCircle size={17} className="spin" /> : tab === 'image' ? <ImagePlus size={17} /> : <Link2 size={17} />}{tab === 'image' ? vi ? 'Nhập ảnh' : 'Import image' : vi ? 'Chèn liên kết' : 'Insert link'}</button></form>{error && <p className="notebook-media-error" role="alert">{notebookMediaError(error, vi)}</p>}
  </dialog>;
}
