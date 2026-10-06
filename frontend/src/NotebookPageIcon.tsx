import type { CSSProperties } from 'react';

// A shared document outline keeps Page blocks, the tree, and menus consistent.
export function NotebookPageIcon({ icon, size = 18 }: { icon?: string; size?: number }) {
  if (icon) return <span className="notebook-page-emoji" style={{ fontSize: size, lineHeight: 1 } as CSSProperties} aria-hidden="true">{icon}</span>;
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" /><path d="M14 3v6h6M8 13h8M8 17h8M8 9h2" /></svg>;
}

export type NotebookPageInfo = { id: string; title: string; parent_id: string | null; icon?: string; favorite?: boolean; updated_at?: string };
export type NotebookPageAction = 'rename' | 'icon' | 'favorite' | 'duplicate' | 'move' | 'peek' | 'trash';
