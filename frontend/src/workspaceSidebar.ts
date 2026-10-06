export const SIDEBAR_MIN = 220;
export const SIDEBAR_DEFAULT = 270;
export const SIDEBAR_MAX = 600;
export function sidebarLimit(viewport: number) {
  return Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, viewport - 480));
}
export function sidebarWidth(value: number, viewport: number) {
  return Math.round(Math.max(SIDEBAR_MIN, Math.min(sidebarLimit(viewport), Number.isFinite(value) ? value : SIDEBAR_DEFAULT)));
}
export function restoreSidebar(value: unknown) {
  const saved = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return { width: sidebarWidth(typeof saved.width === 'number' ? saved.width : SIDEBAR_DEFAULT, 1920), collapsed: saved.collapsed === true };
}
