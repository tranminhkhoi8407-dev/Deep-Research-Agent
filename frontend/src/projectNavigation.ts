export type ProjectPane = 'overview' | 'pages' | 'discussion' | 'meetings' | 'tasks' | 'evidence' | 'members' | 'activity' | 'settings' | 'archived';
export type ProjectRoute = { projectId: string | null; pageId: string | null; pane: ProjectPane };
const panes: ProjectPane[] = ['overview', 'pages', 'discussion', 'meetings', 'tasks', 'evidence', 'members', 'activity', 'settings', 'archived'];
const idPattern = /^[a-f0-9]{32}$/;
export const isProjectPageHash = (value: unknown): value is string => typeof value === 'string' && /^#\/collab\/page\/[a-f0-9]{32}$/.test(value);

export function projectWorkspaceRoute(hash: string): ProjectRoute | null {
  const page = /^#\/collab\/page\/([a-f0-9]{32})$/.exec(hash);
  if (page) return { projectId: null, pageId: page[1], pane: 'pages' };
  const project = /^#\/collab\/project\/([a-f0-9]{32})(?:\?([^#]*))?$/.exec(hash);
  if (!project) return null;
  const query = new URLSearchParams(project[2]);
  if ([...query.keys()].some(key => !['view', 'page'].includes(key)) || query.getAll('view').length > 1 || query.getAll('page').length > 1) return null;
  const pane = query.get('view') ?? 'overview', pageId = query.get('page');
  if (!panes.includes(pane as ProjectPane) || (pageId !== null && !idPattern.test(pageId))) return null;
  return { projectId: project[1], pageId: pageId || null, pane: pane as ProjectPane };
}

export function projectHash(projectId: string, pane: ProjectPane = 'overview', pageId?: string | null) {
  if (!idPattern.test(projectId) || !panes.includes(pane)) throw new Error('Invalid project route');
  if (pageId && !idPattern.test(pageId)) throw new Error('Invalid page route');
  if (pane === 'pages' && pageId) return `#/collab/page/${pageId}`;
  const query = new URLSearchParams();
  if (pane !== 'overview') query.set('view', pane);
  if (pageId) query.set('page', pageId);
  return `#/collab/project/${projectId}${query.size ? `?${query}` : ''}`;
}

export function projectPaneAllowed(pane: ProjectPane, access: number) {
  if (pane === 'pages') return true;
  if (pane === 'settings' || pane === 'archived') return access >= 4;
  return access >= 1;
}

export type ProjectTreePage = { id: string; parent_id: string | null; position?: number; title: string };
export function projectTree<T extends ProjectTreePage>(pages: T[], collapsed: Set<string> = new Set()) {
  const result: { page: T; depth: number }[] = [], visited = new Set<string>();
  const byId = new Map(pages.map(page => [page.id, page]));
  const walk = (page: T, depth: number) => {
    if (visited.has(page.id)) return;
    visited.add(page.id); result.push({ page, depth });
    const children = pages.filter(item => item.parent_id === page.id);
    if (collapsed.has(page.id)) {
      const hide = (item: T) => { if (visited.has(item.id)) return; visited.add(item.id); pages.filter(child => child.parent_id === item.id).forEach(hide); };
      children.forEach(hide);
    } else children.forEach(child => walk(child, depth + 1));
  };
  pages.filter(page => !page.parent_id || !byId.has(page.parent_id)).forEach(page => walk(page, 0));
  pages.forEach(page => walk(page, 0)); // Survive malformed/cyclic historic data without recursion loops.
  return result;
}

export function restoreProjectMemory(value: unknown, pageIds: Set<string>) {
  const saved = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const pageId = typeof saved.pageId === 'string' && pageIds.has(saved.pageId) ? saved.pageId : null;
  const scroll: Record<string, number> = {};
  if (saved.scroll && typeof saved.scroll === 'object') {
    for (const [id, offset] of Object.entries(saved.scroll)) if (pageIds.has(id) && typeof offset === 'number' && Number.isFinite(offset) && offset >= 0 && offset <= 1e7) scroll[id] = offset;
  }
  const collapsed = Array.isArray(saved.collapsed) ? saved.collapsed.filter((id): id is string => typeof id === 'string' && pageIds.has(id)) : [];
  return { pageId, scroll, collapsed: [...new Set(collapsed)], toolsCollapsed: saved.toolsCollapsed === true };
}
