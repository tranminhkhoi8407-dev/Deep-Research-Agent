import { useEffect, useRef, useState, type PointerEvent, type Dispatch, type SetStateAction } from 'react';
import { SIDEBAR_MIN, sidebarLimit, sidebarWidth, restoreSidebar } from './workspaceSidebar';
import type { Language } from './ProductViews';

export function useNotebookSidebar(userId: string) {
  const key = `nexora-workspace-sidebar:${userId}`;
  const [preference, setPreference] = useState(() => {
    try { return restoreSidebar(JSON.parse(localStorage.getItem(key) || 'null')); } catch { return restoreSidebar(null); }
  });
  const [viewport, setViewport] = useState(window.innerWidth);
  useEffect(() => { const resized = () => setViewport(window.innerWidth); window.addEventListener('resize', resized); return () => window.removeEventListener('resize', resized); }, []);
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(preference)); } catch { /* Resizing works without persistence. */ } }, [key, preference]);
  const setCollapsed: Dispatch<SetStateAction<boolean>> = value => setPreference(previous => ({ ...previous, collapsed: typeof value === 'function' ? value(previous.collapsed) : value }));
  return { width: sidebarWidth(preference.width, viewport), maxWidth: sidebarLimit(viewport), collapsed: preference.collapsed, setCollapsed, setWidth: (width: number) => setPreference(previous => ({ ...previous, width: sidebarWidth(width, window.innerWidth) })) };
}
export type SidebarControls = ReturnType<typeof useNotebookSidebar>;

export function NotebookSidebarEdge({ controls, language, sidebarId = 'field-sidebar' }: { controls: SidebarControls; language: Language; sidebarId?: string }) {
  const vi = language === 'vi', [dragging, setDragging] = useState(false);
  const drag = useRef<{ pointer: number; x: number; width: number; moved: boolean } | null>(null);
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointer: event.pointerId, x: event.clientX, width: controls.width, moved: false }; setDragging(true);
  };
  const finish = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const current = drag.current; if (!current || event.pointerId !== current.pointer) return;
    drag.current = null; setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!cancelled && !current.moved) controls.setCollapsed(true);
  };
  return <div className={`notebook-sidebar-edge ${dragging ? 'is-dragging' : ''}`} role="separator" aria-orientation="vertical" aria-label={vi ? 'Thay đổi chiều rộng sidebar' : 'Resize sidebar'} aria-controls={sidebarId} aria-valuemin={SIDEBAR_MIN} aria-valuemax={controls.maxWidth} aria-valuenow={controls.width} tabIndex={controls.collapsed ? -1 : 0}
    onPointerDown={start} onPointerMove={event => {
      const current = drag.current; if (!current || event.pointerId !== current.pointer) return;
      if (Math.abs(event.clientX - current.x) > 4) current.moved = true;
      if (current.moved) controls.setWidth(current.width + event.clientX - current.x);
    }} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
    onKeyDown={event => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); controls.setWidth(event.key === 'Home' ? SIDEBAR_MIN : event.key === 'End' ? controls.maxWidth : controls.width + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 50 : 10));
      } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); controls.setCollapsed(true); }
    }}><span className="notebook-sidebar-edge-tip">{vi ? 'Nhấn hoặc Ctrl+\\ để đóng' : 'Click or Ctrl+\\ to close'}<br />{vi ? 'Kéo để đổi chiều rộng' : 'Drag to resize'}</span></div>;
}
