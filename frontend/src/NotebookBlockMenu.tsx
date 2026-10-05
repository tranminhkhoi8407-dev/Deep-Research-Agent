import { useEffect, useState } from 'react';
import { SideMenuExtension } from '@blocknote/core/extensions';
import { blockTypeSelectItems, BlockColorsItem, DragHandleMenu, RemoveBlockItem, TableColumnHeaderItem, TableRowHeaderItem, useBlockNoteEditor, useComponentsContext, useEditorState, useExtensionState, usePortalElement, type BlockTypeSelectItem } from '@blocknote/react';
import { ArrowDown, ArrowUp, Check, Code, Copy, FileText, Link, Replace, Search, Sigma } from 'lucide-react';
import { blockTextStats, equationSource, freshBlockCopy } from './notebookMath';
import type { Language } from './ProductViews';

export function NotebookBlockMenu({ language, apiBase, pageId, onConvertToPage }: { language: Language; apiBase: string; pageId: string; onConvertToPage?: (blockId: string) => void }) {
  const editor = useBlockNoteEditor<any, any, any>();
  const components = useComponentsContext()!;
  const portalElement = usePortalElement();
  const Menu = components.Generic.Menu;
  const hoveredBlock = useExtensionState(SideMenuExtension, { editor, selector: state => state?.block });
  // The hover extension freezes its snapshot while a menu is open. Read the
  // current document so conversions and remote edits never leave stale actions.
  const block = useEditorState({ editor, selector: () => hoveredBlock && editor.getBlock(hoveredBlock.id) });
  const [copyStatus, setCopyStatus] = useState('');
  const [query, setQuery] = useState('');
  const [activity, setActivity] = useState<{ edited_by: { display_name: string; public_name?: string } | null; edited_at: string | null } | null>(null);
  const [activityError, setActivityError] = useState(false);
  const signature = JSON.stringify(block);
  useEffect(() => {
    setActivity(null); setActivityError(false); setCopyStatus('');
    if (!block) return;
    const controller = new AbortController();
    // Debounce typing/remote edits; opening another block cancels the old lookup.
    const timer = setTimeout(() => {
      void fetch(`${apiBase}/api/collab/pages/${pageId}/blocks/${encodeURIComponent(block.id)}/activity`, { credentials: 'include', signal: controller.signal })
        .then(async response => { if (!response.ok) throw Error('Activity unavailable'); return response.json(); })
        .then(value => { if (!controller.signal.aborted) setActivity(value); })
        .catch(() => { if (!controller.signal.aborted) setActivityError(true); });
    }, 500);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [apiBase, pageId, signature]);
  useEffect(() => setQuery(''), [block?.id]);
  if (!block) return null;
  const vi = language === 'vi';
  const matches = (...names: string[]) => !query.trim() || names.join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const types: BlockTypeSelectItem[] = [...blockTypeSelectItems(editor.dictionary).filter(item => item.type in editor.schema.blockSchema), { name: vi ? 'Mã nguồn' : 'Code', type: 'codeBlock', icon: Code }, { name: 'Block equation', type: 'mathBlock', icon: Sigma }];
  const textBlock = typeof block.content === 'string' || Array.isArray(block.content);
  const stats = blockTextStats(block);
  const typeName = types.find(item => item.type === block.type && Object.entries(item.props || {}).every(([key, value]) => block.props[key] === value))?.name || (block.type === 'pageLink' ? (vi ? 'Trang' : 'Page') : block.type === 'table' ? (vi ? 'Bảng' : 'Table') : block.type);
  const changeType = (type: string, props?: Record<string, boolean | number | string>) => {
    if (!editor.isEditable) return;
    editor.focus();
    // Math uses plain source. Preserve the whole source when changing either way.
    const content = type === 'mathBlock' || type === 'codeBlock' ? equationSource(block.content as never)
      : block.type === 'mathBlock' ? [{ type: 'math', content: equationSource(block.content as never) }]
      : block.content;
    editor.updateBlock(block, { type, props, content });
    editor.setTextCursorPosition(block.id, 'end');
  };
  const copyLink = async () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('workspaceTour');
    url.searchParams.set('block', block.id);
    try { await navigator.clipboard.writeText(url.href); setCopyStatus(vi ? 'Đã sao chép' : 'Copied'); }
    catch { setCopyStatus(vi ? 'Không thể sao chép' : 'Could not copy'); }
  };
  return <DragHandleMenu>
    <div className="notebook-action-search"><Search size={14} /><input aria-label={vi ? 'Tìm thao tác khối' : 'Search block actions'} placeholder={vi ? 'Tìm thao tác…' : 'Search actions…'} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation(); }} /></div>
    <div className="notebook-action-caption">{typeName}</div>
    {textBlock && matches('Chuyển thành Turn into', ...types.map(item => item.name), 'Trang Page') && <Menu.Root sub position="right" portalElement={portalElement}>
      <Menu.Trigger sub><Menu.Item className="bn-menu-item" subTrigger><Replace size={16} />{vi ? 'Chuyển thành' : 'Turn into'}</Menu.Item></Menu.Trigger>
      <Menu.Dropdown sub className="bn-menu-dropdown notebook-turn-into">
        {types.map((item, index) => { const Icon = item.icon; const selected = item.type === block.type && Object.entries(item.props || {}).every(([key, value]) => block.props[key] === value); return <Menu.Item key={index} className="bn-menu-item" onClick={() => changeType(item.type, item.props)}><Icon size={16} />{item.name}{selected && <Check size={14} />}</Menu.Item>; })}
        {onConvertToPage && <Menu.Item className="bn-menu-item" onClick={() => onConvertToPage(block.id)}><FileText size={16} />{vi ? 'Trang' : 'Page'}</Menu.Item>}
      </Menu.Dropdown>
    </Menu.Root>}
    {matches('Màu sắc Color') && <BlockColorsItem>{vi ? 'Màu sắc' : 'Color'}</BlockColorsItem>}
    <Menu.Divider />
    {matches('Sao chép liên kết khối Copy link to block') && <Menu.Item className="bn-menu-item" onClick={() => void copyLink()}><Link size={16} />{copyStatus || (vi ? 'Sao chép liên kết khối' : 'Copy link to block')}</Menu.Item>}
    {matches('Nhân bản Duplicate') && <Menu.Item className="bn-menu-item" onClick={() => { if (editor.isEditable) editor.insertBlocks([freshBlockCopy(block)], block, 'after'); }}><Copy size={16} />{vi ? 'Nhân bản' : 'Duplicate'}</Menu.Item>}
    {matches('Chuyển lên Move up') && <Menu.Item className="bn-menu-item" onClick={() => { if (editor.isEditable) editor.moveBlocksUp(block); }}><ArrowUp size={16} />{vi ? 'Chuyển lên' : 'Move up'}</Menu.Item>}
    {matches('Chuyển xuống Move down') && <Menu.Item className="bn-menu-item" onClick={() => { if (editor.isEditable) editor.moveBlocksDown(block); }}><ArrowDown size={16} />{vi ? 'Chuyển xuống' : 'Move down'}</Menu.Item>}
    {matches('Hàng tiêu đề Header row') && <TableRowHeaderItem>{vi ? 'Hàng tiêu đề' : 'Header row'}</TableRowHeaderItem>}
    {matches('Cột tiêu đề Header column') && <TableColumnHeaderItem>{vi ? 'Cột tiêu đề' : 'Header column'}</TableColumnHeaderItem>}
    {matches('Xóa Delete') && <RemoveBlockItem>{vi ? 'Xóa' : 'Delete'}</RemoveBlockItem>}
    <Menu.Divider />
    <div className="notebook-action-metadata" aria-live="polite">
      <span>{activity?.edited_by ? `${vi ? 'Sửa lần cuối bởi' : 'Last edited by'} ${activity.edited_by.public_name || activity.edited_by.display_name}` : activityError ? (vi ? 'Chưa tải được lịch sử chỉnh sửa' : 'Edit history unavailable') : (vi ? 'Đang tải lịch sử…' : 'Loading edit history…')}</span>
      {activity?.edited_at && <time dateTime={activity.edited_at}>{new Date(activity.edited_at).toLocaleString(vi ? 'vi-VN' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' })}</time>}
      <span>{stats.words} {vi ? 'từ' : 'words'}, {stats.characters} {vi ? 'ký tự' : 'characters'}</span>
    </div>
  </DragHandleMenu>;
}
