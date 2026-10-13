import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../src/authSession.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const { readLoginSession, saveLoginSession, LoginSessionError } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);
const session = {
  remembered: true,
  choice_pending: false,
  expires_at: "2026-10-12T12:00:00Z",
  persistent_days: 30,
  session_hours: 12,
};

test("server session metadata is validated instead of assuming browser persistence", () => {
  assert.deepEqual(readLoginSession(session), session);
  for (const value of [
    null,
    {},
    { ...session, remembered: "true" },
    { ...session, choice_pending: 1 },
    { ...session, expires_at: "invalid" },
    { ...session, persistent_days: 0 },
    { ...session, session_hours: 1.5 },
  ])
    assert.equal(readLoginSession(value), null);
});

test("profile persistence changes use authenticated JSON and an explicit intent header", async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "/fixture/api/auth/session");
      assert.equal(init.method, "PUT");
      assert.equal(init.credentials, "include");
      assert.equal(init.cache, "no-store");
      assert.equal(init.headers["X-Nexora-Session-Intent"], "update");
      assert.deepEqual(JSON.parse(init.body), { remember: true });
      return Response.json({
        session: { ...session, choice_pending: false, remembered: true },
      });
    };
    assert.equal((await saveLoginSession("/fixture", true)).remembered, true);
  } finally {
    globalThis.fetch = previous;
  }
});

test("errors, stale pending metadata or mismatched settings never count as success", async () => {
  const previous = globalThis.fetch;
  try {
    for (const [payload, status] of [
      [{}, 401],
      [{ session: { ...session, choice_pending: true } }, 200],
      [{ session: { ...session, remembered: false } }, 200],
      [{ session: {} }, 200],
    ]) {
      globalThis.fetch = async () => Response.json(payload, { status });
      await assert.rejects(
        saveLoginSession("/fixture", true),
        LoginSessionError,
      );
    }
  } finally {
    globalThis.fetch = previous;
  }
});
