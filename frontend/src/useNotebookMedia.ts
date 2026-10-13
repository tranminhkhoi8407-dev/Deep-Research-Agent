import { useEffect, useRef, useState } from 'react';
import type { BlockNoteEditor } from '@blocknote/core';
import { safeNotebookURL } from './notebookMediaModel';

export function useNotebookMedia(editor: BlockNoteEditor<any, any, any>, apiBase: string, pageId: string, writable: boolean) {
  const [mode, setMode] = useState<'image' | 'link' | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const alive = useRef(true), access = useRef(writable), lock = useRef(false), epoch = useRef(0), target = useRef(''), requests = useRef(new Set<AbortController>());
  access.current = writable;
  const cursor = () => { try { return editor.getTextCursorPosition().block.id; } catch { return editor.document[editor.document.length - 1]?.id || ''; } };
  const close = () => { epoch.current++; requests.current.forEach(controller => controller.abort()); setMode(null); };
  useEffect(() => { alive.current = true; return () => { alive.current = false; epoch.current++; requests.current.forEach(controller => controller.abort()); }; }, [pageId]);
  useEffect(() => { if (!writable) { epoch.current++; requests.current.forEach(controller => controller.abort()); setMode(null); } }, [writable]);
  const open = (value: 'image' | 'link') => { if (editor.isEditable && access.current) { target.current = cursor(); setError(''); setMode(value); } };
  const api = async (path: string, init: RequestInit) => {
    const controller = new AbortController(); requests.current.add(controller);
    const deadline = setTimeout(() => controller.abort(), 35000);
    try {
      const response = await fetch(`${apiBase}/api/collab/pages/${pageId}/images${path}`, { credentials: 'include', ...init, signal: controller.signal });
      const value = await response.json();
      if (!response.ok) throw new Error(typeof value.detail === 'string' ? value.detail : 'request_failed');
      if (!/^[a-f0-9]{32}$/.test(value.id) || typeof value.name !== 'string') throw new Error('request_failed');
      return value as { id: string; name: string };
    } finally { clearTimeout(deadline); requests.current.delete(controller); }
  };
  const insert = (blocks: any[], reference: string, token: number) => {
    if (!alive.current || epoch.current !== token || !access.current || !editor.isEditable) return;
    const current = editor.getBlock(reference) || editor.document[editor.document.length - 1];
    if (current) editor.insertBlocks(blocks, current, 'after');
  };
  const uploadFiles = async (files: File[], reference = target.current || cursor()) => {
    if (!files.length || lock.current || !editor.isEditable || !access.current) return;
    let problem = files.length > 3 ? 'notebook_image_count' : files.some(file => !file.size || file.size > 10 * 1024 * 1024) ? 'notebook_image_size' : files.some(file => !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) ? 'notebook_image_invalid' : '';
    if (problem) { setError(problem); return; }
    lock.current = true; setBusy(true); setError(''); const token = epoch.current;
    try {
      let after = reference;
      for (const file of files) {
        if (epoch.current !== token || !access.current) break;
        const image = await api('', { method: 'POST', headers: { 'Content-Type': file.type, 'X-Image-Name': encodeURIComponent(file.name) }, body: file });
        const id = crypto.randomUUID();
        insert([{ id, type: 'notebookImage', props: { assetId: image.id, name: image.name, caption: '' } }], after, token); after = id;
      }
      if (alive.current && token === epoch.current) setMode(null);
    } catch (reason) { if (alive.current && token === epoch.current) setError((reason as Error).message); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  const imageURL = async (url: string) => {
    if (lock.current || !editor.isEditable || !access.current) return;
    const safe = safeNotebookURL(url); if (!safe) { setError('notebook_url_invalid'); return; }
    lock.current = true; setBusy(true); setError(''); const token = epoch.current, reference = target.current || cursor();
    try { const image = await api('/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: safe }) }); insert([{ type: 'notebookImage', props: { assetId: image.id, name: image.name, caption: '' } }], reference, token); if (alive.current && token === epoch.current) setMode(null); }
    catch (reason) { if (alive.current && token === epoch.current) setError((reason as Error).message); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  const link = (url: string, title = '', reference = target.current || cursor()) => {
    const safe = safeNotebookURL(url); if (!safe) { setError('notebook_url_invalid'); return; }
    insert([{ type: 'webLink', props: { url: safe, title: title.slice(0, 200) } }], reference, epoch.current); setMode(null); editor.focus();
  };
  return { mode, busy, error, open, close, uploadFiles, imageURL, link, cursor };
}
