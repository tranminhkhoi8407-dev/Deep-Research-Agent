export type TabEntry = { hash: string; title: string; icon: string };
export type WorkspaceTab = { id: string; history: TabEntry[]; index: number };
export type TabState = { tabs: WorkspaceTab[]; active: string };
export const tabLimit = 20;
const validHash = (value: unknown): value is string => typeof value === 'string' && /^#\/fields\/(mathematics|physics|chemistry|biology|artificial-intelligence)(\/page\/[a-f0-9]{32})?$/.test(value);
export function restoreTabs(value: unknown, validate: (value: unknown) => boolean = validHash): TabState {
  if (!value || typeof value !== 'object') return { tabs: [], active: '' };
  const saved = value as Partial<TabState>, ids = new Set<string>();
  const tabs: WorkspaceTab[] = [];
  for (const tab of Array.isArray(saved.tabs) ? saved.tabs.slice(0, tabLimit) : []) {
    if (!tab || typeof tab.id !== 'string' || !tab.id || ids.has(tab.id) || !Array.isArray(tab.history)) continue;
    if (tab.history.length > 50 || !tab.history.length || !tab.history.every(entry => entry && validate(entry.hash) && typeof entry.title === 'string' && typeof entry.icon === 'string')) continue;
    ids.add(tab.id);
    tabs.push({ id: tab.id, history: tab.history.map(entry => ({ hash: entry.hash, title: entry.title.slice(0, 120), icon: entry.icon.slice(0, 16) })), index: Number.isInteger(tab.index) ? Math.max(0, Math.min(tab.index, tab.history.length - 1)) : 0 });
  }
  return { tabs, active: tabs.some(tab => tab.id === saved.active) ? saved.active! : tabs[0]?.id || '' };
}
export function visitTab(state: TabState, entry: TabEntry, newId?: string, validate: (value: unknown) => boolean = validHash): TabState {
  if (!validate(entry.hash)) return state;
  if (newId && state.tabs.length >= tabLimit) return state;
  const active = state.tabs.find(tab => tab.id === state.active);
  if (newId || !active) {
    const id = newId || crypto.randomUUID();
    return { tabs: [...state.tabs, { id, history: [entry], index: 0 }], active: id };
  }
  if (active.history[active.index].hash === entry.hash) return state;
  const history = [...active.history.slice(0, active.index + 1), entry].slice(-50);
  return { ...state, tabs: state.tabs.map(tab => tab.id === active.id ? { ...tab, history, index: history.length - 1 } : tab) };
}
export function closeTab(state: TabState, id: string): TabState {
  const index = state.tabs.findIndex(tab => tab.id === id);
  if (index < 0) return state;
  const tabs = state.tabs.filter(tab => tab.id !== id);
  return { tabs, active: state.active === id ? tabs[Math.min(index, tabs.length - 1)]?.id || '' : state.active };
}
export function stepTab(state: TabState, direction: number): TabState {
  return { ...state, tabs: state.tabs.map(tab => tab.id === state.active ? { ...tab, index: Math.max(0, Math.min(tab.index + direction, tab.history.length - 1)) } : tab) };
}
export function relativeTime(value: string, vi: boolean, timestamp = Date.now()): string {
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return vi ? 'không rõ thời gian' : 'unknown time';
  const minutes = Math.max(0, Math.floor((timestamp - date) / 60000));
  if (!minutes) return vi ? 'vừa xong' : 'just now';
  if (minutes < 60) return vi ? `${minutes} phút trước` : `${minutes}m ago`;
  if (minutes < 1440) return vi ? `${Math.floor(minutes / 60)} giờ trước` : `${Math.floor(minutes / 60)}h ago`;
  if (minutes < 10080) return vi ? `${Math.floor(minutes / 1440)} ngày trước` : `${Math.floor(minutes / 1440)}d ago`;
  return new Date(date).toLocaleDateString(vi ? 'vi-VN' : 'en-US');
}
export function notebookLink(pageId: string): string {
  // A guest link resolves through the page's access check, not the owner's field workspace.
  const url = new URL(window.location.href);
  url.search = ''; url.hash = `#/collab/page/${pageId}`;
  return url.toString();
}
