import type { ResearchDomainId } from './DomainHub';

export const fieldIds = ['mathematics', 'physics', 'chemistry', 'biology', 'artificial-intelligence'] as const;
export function fieldRoute(hash: string): { field: ResearchDomainId; pageId: string | null } | null {
  const match = /^#\/fields\/([^/?]+)(?:\/page\/([a-f0-9]{32}))?$/.exec(hash);
  if (!match || !fieldIds.includes(match[1] as ResearchDomainId)) return null;
  return { field: match[1] as ResearchDomainId, pageId: match[2] || null };
}
export function fieldHash(field: ResearchDomainId, pageId?: string) {
  return `#/fields/${field}${pageId ? `/page/${pageId}` : ''}`;
}
export type TreePage = { id: string; parent_id: string | null };
export function pageAncestors<T extends TreePage>(pages: T[], id: string): T[] {
  const byId = new Map(pages.map(page => [page.id, page]));
  const path: T[] = [], seen = new Set<string>();
  let page = byId.get(id);
  while (page && !seen.has(page.id)) {
    seen.add(page.id); path.unshift(page); page = page.parent_id ? byId.get(page.parent_id) : undefined;
  }
  return path;
}
export function pageDescendants(pages: TreePage[], id: string): Set<string> {
  const result = new Set([id]), pending = [id];
  while (pending.length) {
    const parent = pending.pop();
    for (const page of pages) if (page.parent_id === parent && !result.has(page.id)) { result.add(page.id); pending.push(page.id); }
  }
  return result;
}
