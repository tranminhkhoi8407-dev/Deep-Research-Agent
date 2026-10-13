export interface LoginSession {
  remembered: boolean;
  choice_pending: boolean;
  expires_at: string | null;
  persistent_days: number;
  session_hours: number;
}

export function readLoginSession(value: unknown): LoginSession | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<LoginSession>;
  if (
    typeof data.remembered !== "boolean" ||
    typeof data.choice_pending !== "boolean" ||
    !Number.isInteger(data.persistent_days) ||
    Number(data.persistent_days) < 1 ||
    !Number.isInteger(data.session_hours) ||
    Number(data.session_hours) < 1 ||
    !(
      data.expires_at === null ||
      (typeof data.expires_at === "string" &&
        Number.isFinite(Date.parse(data.expires_at)))
    )
  )
    return null;
  return data as LoginSession;
}

export class LoginSessionError extends Error {
  constructor(public status: number) {
    super("Could not update login session");
  }
}

export async function saveLoginSession(
  apiBase: string,
  remember: boolean,
): Promise<LoginSession> {
  const response = await fetch(`${apiBase}/api/auth/session`, {
    method: "PUT",
    credentials: "include",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-Nexora-Session-Intent": "update",
    },
    body: JSON.stringify({ remember }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new LoginSessionError(response.status);
  const payload = (await response.json()) as { session?: unknown };
  const session = readLoginSession(payload.session);
  if (!session || session.choice_pending || session.remembered !== remember)
    throw new LoginSessionError(502);
  return session;
}

// This is only a cross-tab refresh signal. Never put credentials/profile here.
export const loginSessionChangedKey = "nexora-login-session-changed";
export function announceLoginSessionChange() {
  try {
    window.localStorage.setItem(loginSessionChangedKey, crypto.randomUUID());
  } catch {
    /* Storage can be blocked. */
  }
}
