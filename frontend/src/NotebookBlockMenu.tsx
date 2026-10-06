import { useEffect, useState } from 'react';
import { SideMenuExtension } from '@blocknote/core/extensions';
import { blockTypeSelectItems, BlockColorsItem, DragHandleMenu, TableColumnHeaderItem, TableRowHeaderItem, useBlockNoteEditor, useComponentsContext, useEditorState, useExtensionState, usePortalElement, type BlockTypeSelectItem } from '@blocknote/react';
import { AppWindow, ArrowDown, ArrowUp, ArrowUpRight, Check, Code, Copy, CornerUpRight, Link, PaintRoller, PanelRight, Repeat2, Search, Sigma, Smile, SquarePen, Star, Trash2 } from 'lucide-react';
import { NotebookPageIcon, type NotebookPageAction, type NotebookPageInfo } from './NotebookPageIcon';
import { NotebookMenuPortal } from './NotebookMenuPortal';
import { blockTextStats, equationSource, freshBlockCopy } from './notebookMath';
import type { Language } from './ProductViews';

type NotebookBlockMenuProps = {
  language: Language; apiBase: string; pageId: string; onConvertToPage?: (blockId: string) => void;
  pageContext?: () => { pages?: NotebookPageInfo[]; href?: (id: string) => string; act?: (id: string, action: NotebookPageAction) => void };
  onTurnPageInto?: (blockId: string, type: string, props?: Record<string, boolean | number | string>) => void;
};

export function NotebookBlockMenu(props: NotebookBlockMenuProps) {
  return <NotebookMenuPortal><NotebookBlockMenuContent {...props} /></NotebookMenuPortal>;
}

function NotebookBlockMenuContent({ language, apiBase, pageId, onConvertToPage, pageContext, onTurnPageInto }: NotebookBlockMenuProps) {
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
  const pageBlock = block?.type === 'pageLink';
  const targetId = pageBlock ? block.props.pageId : '';
  const context = pageContext?.();
  const target = context?.pages?.find(item => item.id === targetId);
  const ownedChild = !!context?.act && target?.parent_id === pageId;
  const signature = JSON.stringify(block);
  useEffect(() => {
    setActivity(null); setActivityError(false); setCopyStatus('');
    if (!block || pageBlock) return;
    const controller = new AbortController();
    // Debounce typing/remote edits; opening another block cancels the old lookup.
    const timer = setTimeout(() => {
      void fetch(`${apiBase}/api/collab/pages/${pageBlock ? targetId : `${pageId}/blocks/${encodeURIComponent(block.id)}/activity`}`, { credentials: 'include', signal: controller.signal })
        .then(async response => { if (!response.ok) throw Error('Activity unavailable'); return response.json(); })
        .then(value => { if (!controller.signal.aborted) setActivity(pageBlock ? { edited_by: value.last_editor, edited_at: value.page.updated_at } : value); })
        .catch(() => { if (!controller.signal.aborted) setActivityError(true); });
    }, 500);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [apiBase, pageId, signature, target?.updated_at]);
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
    // The asynchronous Page conversion can remove the hovered block. Dismiss
    // its frozen menu now so actions cannot linger on a deleted Page snapshot.
    editor.getExtension(SideMenuExtension)?.unfreezeMenu();
    if (pageBlock) { onTurnPageInto?.(block.id, type, props); return; }
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
    if (pageBlock) { url.searchParams.delete('block'); url.hash = context?.href?.(targetId) || `#/collab/page/${targetId}`; }
    else url.searchParams.set('block', block.id);
    try { await navigator.clipboard.writeText(url.href); setCopyStatus(vi ? 'Đã sao chép' : 'Copied'); }
    catch { setCopyStatus(vi ? 'Không thể sao chép' : 'Could not copy'); }
  };
  const pageUrl = () => { const url = new URL(window.location.href); url.searchParams.delete('workspaceTour'); url.searchParams.delete('block'); url.hash = context?.href?.(targetId) || `#/collab/page/${targetId}`; return url.href; };
  const act = (action: NotebookPageAction) => context?.act?.(targetId, action);
  return <DragHandleMenu>
    <div className="notebook-action-search"><Search size={14} /><input aria-label={vi ? 'Tìm thao tác khối' : 'Search block actions'} placeholder={vi ? 'Tìm thao tác…' : 'Search actions…'} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation(); }} /></div>
    <div className="notebook-action-caption">{typeName}</div>
    {(textBlock || (pageBlock && onTurnPageInto)) && matches('Chuyển thành Turn into', ...types.map(item => item.name), 'Trang Page') && <Menu.Root sub position="right" portalElement={portalElement}>
      <Menu.Trigger sub><Menu.Item className="bn-menu-item" subTrigger><Repeat2 size={18} />{vi ? 'Chuyển thành' : 'Turn into'}</Menu.Item></Menu.Trigger>
      <Menu.Dropdown sub className="bn-menu-dropdown notebook-turn-into">
        {types.map((item, index) => { const Icon = item.icon; const selected = item.type === block.type && Object.entries(item.props || {}).every(([key, value]) => block.props[key] === value); return <Menu.Item key={index} className="bn-menu-item" onClick={() => changeType(item.type, item.props)}><Icon size={16} />{item.name}{selected && <Check size={14} />}</Menu.Item>; })}
        {onConvertToPage && <Menu.Item className="bn-menu-item" onClick={() => { if (!pageBlock) { editor.getExtension(SideMenuExtension)?.unfreezeMenu(); onConvertToPage(block.id); } }}><NotebookPageIcon />{vi ? 'Trang' : 'Page'}{pageBlock && <Check size={14} />}</Menu.Item>}
      </Menu.Dropdown>
    </Menu.Root>}
    {matches('Màu sắc Color') && <BlockColorsItem><PaintRoller size={18} />{vi ? 'Màu sắc' : 'Color'}</BlockColorsItem>}
    {pageBlock && target && context?.act && <>
      {matches('Đổi biểu tượng Edit icon') && <Menu.Item className="bn-menu-item" onClick={() => act('icon')}><Smile size={18} />{vi ? 'Đổi biểu tượng' : 'Edit icon'}</Menu.Item>}
      {matches('Yêu thích Add to Favorites Remove from Favorites') && <Menu.Item className="bn-menu-item" onClick={() => act('favorite')}><Star size={18} fill={target.favorite ? 'currentColor' : 'none'} />{target.favorite ? (vi ? 'Bỏ yêu thích' : 'Remove from Favorites') : (vi ? 'Thêm vào yêu thích' : 'Add to Favorites')}</Menu.Item>}
      {matches('Đổi tên Rename') && <Menu.Item className="bn-menu-item" onClick={() => act('rename')}><SquarePen size={18} />{vi ? 'Đổi tên' : 'Rename'}</Menu.Item>}
    </>}
    <Menu.Divider />
    {pageBlock && <>
      {matches('Mở trong tab mới Open in new tab') && <Menu.Item className="bn-menu-item" onClick={() => window.open(pageUrl(), '_blank', 'noopener,noreferrer')}><ArrowUpRight size={18} />{vi ? 'Mở trong tab mới' : 'Open in new tab'}</Menu.Item>}
      {matches('Mở trong cửa sổ mới Open in new window') && <Menu.Item className="bn-menu-item" onClick={() => window.open(pageUrl(), '_blank', 'noopener,noreferrer,popup,width=1100,height=800')}><AppWindow size={18} />{vi ? 'Mở trong cửa sổ mới' : 'Open in new window'}</Menu.Item>}
      {target && context?.act && matches('Mở xem bên cạnh Open in side peek') && <Menu.Item className="bn-menu-item" onClick={() => act('peek')}><PanelRight size={18} />{vi ? 'Mở xem bên cạnh' : 'Open in side peek'}</Menu.Item>}
      <Menu.Divider />
    </>}
    {matches('Sao chép liên kết khối Copy link to block') && <Menu.Item className="bn-menu-item" onClick={() => void copyLink()}><Link size={18} />{copyStatus || (pageBlock ? vi ? 'Sao chép liên kết' : 'Copy link' : vi ? 'Sao chép liên kết khối' : 'Copy link to block')}</Menu.Item>}
    {matches('Nhân bản Duplicate') && <Menu.Item className="bn-menu-item" onClick={() => { if (!editor.isEditable) return; if (pageBlock && target && context?.act) act('duplicate'); else editor.insertBlocks([freshBlockCopy(block)], block, 'after'); }}><Copy size={18} />{vi ? 'Nhân bản' : 'Duplicate'}</Menu.Item>}
    {pageBlock && target && context?.act && matches('Di chuyển Move to') && <Menu.Item className="bn-menu-item" onClick={() => act('move')}><CornerUpRight size={18} />{vi ? 'Di chuyển đến' : 'Move to'}</Menu.Item>}
    {!pageBlock && matches('Chuyển lên Move up') && <Menu.Item className="bn-menu-item" onClick={() => { if (editor.isEditable) editor.moveBlocksUp(block); }}><ArrowUp size={18} />{vi ? 'Chuyển lên' : 'Move up'}</Menu.Item>}
    {!pageBlock && matches('Chuyển xuống Move down') && <Menu.Item className="bn-menu-item" onClick={() => { if (editor.isEditable) editor.moveBlocksDown(block); }}><ArrowDown size={18} />{vi ? 'Chuyển xuống' : 'Move down'}</Menu.Item>}
    {matches('Hàng tiêu đề Header row') && <TableRowHeaderItem>{vi ? 'Hàng tiêu đề' : 'Header row'}</TableRowHeaderItem>}
    {matches('Cột tiêu đề Header column') && <TableColumnHeaderItem>{vi ? 'Cột tiêu đề' : 'Header column'}</TableColumnHeaderItem>}
    {matches('Xóa Delete Move to Trash Thùng rác') && <Menu.Item className="bn-menu-item" onClick={() => { if (editor.isEditable) { editor.getExtension(SideMenuExtension)?.unfreezeMenu(); editor.removeBlocks([block]); } }}><Trash2 size={18} />{pageBlock ? ownedChild ? vi ? 'Chuyển vào thùng rác' : 'Move to Trash' : vi ? 'Gỡ liên kết' : 'Remove link' : vi ? 'Xóa' : 'Delete'}</Menu.Item>}
    {!pageBlock && <><Menu.Divider />
    <div className="notebook-action-metadata" aria-live="polite">
      <span>{activity?.edited_by ? `${vi ? 'Sửa lần cuối bởi' : 'Last edited by'} ${activity.edited_by.public_name || activity.edited_by.display_name}` : activityError ? (vi ? 'Chưa tải được lịch sử chỉnh sửa' : 'Edit history unavailable') : (vi ? 'Đang tải lịch sử…' : 'Loading edit history…')}</span>
      {activity?.edited_at && <time dateTime={activity.edited_at}>{new Date(activity.edited_at).toLocaleString(vi ? 'vi-VN' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' })}</time>}
      <span>{stats.words} {vi ? 'từ' : 'words'}, {stats.characters} {vi ? 'ký tự' : 'characters'}</span>
    </div></>}
  </DragHandleMenu>;
}
