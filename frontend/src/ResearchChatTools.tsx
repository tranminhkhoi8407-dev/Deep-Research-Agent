import { useEffect, useRef, useState } from 'react';
import { Archive, Check, CircleHelp, LoaderCircle, Pencil, Pin, PinOff, Search, Volume2, VolumeX, X } from 'lucide-react';
import { chatModeLabel, errorLabel, runningChat, stageLabel, statusLabel, type ChatActivity, type ChatSummary } from './researchChatModel';

export function ChatRowStatus({ job, vi }: { job?: ChatActivity | ChatSummary['latest_job']; vi: boolean }) {
  if (job?.status === 'awaiting_input') return <CircleHelp size={15} className="research-chat__needs-answer" aria-label={statusLabel(job.status, vi)} />;
  if (runningChat(job || undefined)) return <LoaderCircle size={15} className="spin" aria-label={statusLabel(job!.status, vi)} />;
  return <span className="research-chat__row-idle" />;
}

export function ConversationMenu({ item, anchor, vi, active, onClose, onRename, onPin, onArchive }: {
  item: ChatSummary; anchor: HTMLElement; vi: boolean; active: boolean; onClose: () => void; onRename: () => void; onPin: () => void; onArchive: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const rect = anchor.getBoundingClientRect();
  useEffect(() => { dialog.current?.showModal(); return () => { if (anchor.isConnected) anchor.focus(); }; }, [anchor]);
  const action = (callback: () => void) => { dialog.current?.close(); onClose(); callback(); };
  return <dialog ref={dialog} className="research-chat__row-menu" style={{ left: Math.max(8, Math.min(rect.right - 205, innerWidth - 213)), top: Math.max(8, Math.min(rect.bottom + 4, innerHeight - 174)) }} aria-label={vi ? 'Tùy chọn: ' + item.title : 'Options: ' + item.title} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose(); } }}>
    <button type="button" autoFocus aria-label={vi ? 'Đổi tên cuộc trò chuyện' : 'Rename conversation'} onClick={() => action(onRename)}><Pencil size={16} />{vi ? 'Đổi tên' : 'Rename'}</button>
    <button type="button" aria-label={item.pinned ? vi ? 'Bỏ ghim cuộc trò chuyện' : 'Unpin conversation' : vi ? 'Ghim cuộc trò chuyện' : 'Pin conversation'} onClick={() => action(onPin)}>{item.pinned ? <PinOff size={16} /> : <Pin size={16} />}{item.pinned ? vi ? 'Bỏ ghim' : 'Unpin' : vi ? 'Ghim' : 'Pin'}</button>
    <button type="button" className="is-danger" disabled={active} title={active ? vi ? 'Dừng phiên trước khi xóa' : 'Stop the session before deleting' : undefined} onClick={() => action(onArchive)}><Archive size={16} />{vi ? 'Lưu trữ và xóa' : 'Archive & delete'}</button>
  </dialog>;
}

export function ResearchToolsDialog({ mode, vi, api, activities, connectionLost, sound, onSound, onOpen, onClose }: {
  mode: 'search' | 'activity'; vi: boolean; api: (path: string, init?: RequestInit) => Promise<any>; activities: ChatActivity[]; connectionLost: boolean; sound: boolean; onSound: (value: boolean) => void; onOpen: (item: ChatSummary) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), opener = useRef(document.activeElement);
  const [query, setQuery] = useState(''), [results, setResults] = useState<(ChatSummary & { snippet?: string })[]>([]), [loading, setLoading] = useState(false), [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); return () => { if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus(); }; }, []);
  useEffect(() => {
    let disposed = false; setResults([]); setError(''); setLoading(false);
    if (mode !== 'search' || query.trim().length < 2) return;
    setLoading(true);
    const controller = new AbortController();
    let deadline: ReturnType<typeof setTimeout>;
    const timer = setTimeout(() => { deadline = setTimeout(() => controller.abort(), 12000); void api('/search?q=' + encodeURIComponent(query.trim()), { signal: controller.signal }).then(value => { if (!disposed) setResults(value.conversations || []); }).catch(() => { if (!disposed) setError('request_failed'); }).finally(() => { clearTimeout(deadline); if (!disposed) setLoading(false); }); }, 220);
    return () => { disposed = true; clearTimeout(timer); clearTimeout(deadline); controller.abort(); };
  }, [query, mode, api]);
  const activeCount = activities.filter(runningChat).length;
  return <dialog ref={dialog} className="research-chat__tools-dialog" aria-labelledby="research-tools-title" onCancel={onClose}>
    <header><div><h2 id="research-tools-title">{mode === 'search' ? vi ? 'Tìm cuộc trò chuyện' : 'Search conversations' : vi ? 'Hoạt động' : 'Activity'}</h2><p>{mode === 'search' ? vi ? 'Tìm theo tên và nội dung tin nhắn.' : 'Search titles and message content.' : activeCount ? (vi ? `${activeCount} phiên đang chạy hoặc chờ phản hồi` : `${activeCount} sessions running or awaiting input`) : vi ? 'Những lượt xử lý gần đây' : 'Recent runs'}</p></div><button type="button" onClick={onClose} aria-label={vi ? 'Đóng' : 'Close'}><X size={20} /></button></header>
    {mode === 'search' ? <><label className="research-chat__tool-search"><Search size={18} /><input autoFocus maxLength={120} aria-label={vi ? 'Từ khóa tìm kiếm' : 'Search keywords'} placeholder={vi ? 'Nhập ít nhất 2 ký tự…' : 'Type at least 2 characters…'} value={query} onChange={event => setQuery(event.target.value)} /></label><div className="research-chat__tool-results" aria-busy={loading}>{loading && <p role="status"><LoaderCircle size={16} className="spin" />{vi ? 'Đang tìm…' : 'Searching…'}</p>}{error && <p role="alert">{errorLabel(error, vi)}</p>}{!loading && !error && query.trim().length >= 2 && !results.length && <p>{vi ? 'Không tìm thấy cuộc trò chuyện.' : 'No conversations found.'}</p>}{results.map(item => <button type="button" key={item.id} onClick={() => { onClose(); onOpen(item); }}><strong>{item.title}</strong><small>{chatModeLabel(item.engine)}{item.pinned ? vi ? ' · Đã ghim' : ' · Pinned' : ''}</small>{item.snippet && <p>{item.snippet}</p>}</button>)}</div></> : <><div className="research-chat__sound-setting"><span>{vi ? 'Âm báo khi hoàn tất' : 'Completion sound'}<small>{vi ? 'Phát sau khi bạn tương tác với trang; không phát khi tải lại.' : 'Plays after you interact with the page; silent on reload.'}</small></span><button type="button" aria-label={vi ? 'Âm báo khi hoàn tất' : 'Completion sound'} aria-pressed={sound} onClick={() => onSound(!sound)}>{sound ? <Volume2 size={18} /> : <VolumeX size={18} />}{sound ? vi ? 'Bật' : 'On' : vi ? 'Tắt' : 'Off'}</button></div>{connectionLost && <p role="status">{vi ? 'Mất kết nối cập nhật. Trạng thái bên dưới có thể chưa mới nhất.' : 'Updates disconnected. The status below may be outdated.'}</p>}<div className="research-chat__tool-results">{!activities.length && <p>{vi ? 'Chưa có hoạt động.' : 'No activity yet.'}</p>}{activities.map(item => <button type="button" key={item.id} className={'research-chat__activity-item is-' + item.status} onClick={async () => { try { const conversation = await api('/' + encodeURIComponent(item.conversation_id)); onClose(); onOpen(conversation); } catch { setError('request_failed'); } }}><span><ChatRowStatus job={item} vi={vi} />{item.status === 'completed' && <Check size={16} />}<strong>{item.title}</strong></span><small>{chatModeLabel(item.engine)} · {statusLabel(item.status, vi)}{item.updated_at ? ' · ' + new Date(item.updated_at * 1000).toLocaleTimeString(vi ? 'vi-VN' : 'en-US', { hour: '2-digit', minute: '2-digit' }) : ''}</small>{runningChat(item) && <p>{stageLabel(item.stage, vi)}</p>}</button>)}{error && <p role="alert">{errorLabel(error, vi)}</p>}</div></>}
  </dialog>;
}
