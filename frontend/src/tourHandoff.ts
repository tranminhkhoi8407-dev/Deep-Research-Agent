// A one-use, account-bound intent. Ordinary workspace links never restart a tour.
const prefix = 'nexora-tour-handoff:';
export const handoffParameter = 'workspaceTour';
export const handoffLifetime = 10 * 60 * 1000;
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Intent = { userId: string; field: string; createdAt: number; step: 1 };

export function stageFieldTour(url: URL, userId: string, field: string, token: string, storage: Store, now = Date.now()): string {
  storage.setItem(prefix + token, JSON.stringify({ userId, field, createdAt: now, step: 1 } satisfies Intent));
  const destination = new URL(url);
  destination.searchParams.set(handoffParameter, token);
  return destination.href;
}

export function consumeFieldTour(url: URL, userId: string, field: string, storage: Store, now = Date.now()): Intent | null {
  const token = url.searchParams.get(handoffParameter);
  if (!token || !/^[a-f0-9-]{36}$/.test(token)) return null;
  try {
    const raw = storage.getItem(prefix + token);
    if (!raw) return null;
    const intent = JSON.parse(raw) as Intent;
    if (intent.userId !== userId || intent.field !== field) return null;
    storage.removeItem(prefix + token);
    if (intent.step !== 1 || !Number.isFinite(intent.createdAt) || now < intent.createdAt || now - intent.createdAt > handoffLifetime) return null;
    return intent;
  } catch { return null; }
}

export function withoutTourHandoff(url: URL): string {
  const result = new URL(url);
  result.searchParams.delete(handoffParameter);
  return result.pathname + result.search + result.hash;
}
