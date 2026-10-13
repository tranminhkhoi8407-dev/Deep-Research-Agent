/* Exercise the real App using in-memory API responses only. No real accounts. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { mkdir } from "node:fs/promises";
const require = createRequire(import.meta.url);
const { chromium } = process.env.NEXORA_PLAYWRIGHT_DIR
  ? require(path.join(process.env.NEXORA_PLAYWRIGHT_DIR, "playwright"))
  : await import("playwright");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.NEXORA_BROWSER_EXECUTABLE
    ? { executablePath: process.env.NEXORA_BROWSER_EXECUTABLE }
    : {}),
});
const base = process.env.NEXORA_TEST_URL || "http://127.0.0.1:5173";
const errors = [],
  dialogs = [];
let activePage;
const user = {
  id: "google:qa-login",
  provider: "google",
  name: "QA Researcher",
  public_name: "QA Researcher",
  email: "qa@example.invalid",
  avatar_url: null,
  username: null,
  role: "member",
  status: "active",
  license_type: "free",
  license_expires_at: null,
  login_count: 2,
};
const metadata = () => ({
  remembered: true,
  choice_pending: false,
  expires_at: new Date(Date.now() + 30 * 24 * 3600000).toISOString(),
  persistent_days: 30,
  session_hours: 12,
});
async function fixture(language = "vi", theme = "dark", signedIn = true) {
  const context = await browser.newContext({
    viewport: { width: 1360, height: 960 },
  });
  const state = {
    authenticated: signedIn,
    user,
    session: metadata(),
    choices: [],
    logins: [],
    failChoice: 0,
    failLogout: 0,
    holdChoice: false,
    releaseChoice: null,
  };
  await context.addInitScript(
    ({ language, theme }) => {
      localStorage.setItem("deep-research-language", language);
      localStorage.setItem("deep-research-appearance", theme);
    },
    { language, theme },
  );
  await context.route("**/health", (route) =>
    route.fulfill({ json: { status: "ok" } }),
  );
  await context.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      endpoint = url.pathname;
    const respond = (json, status = 200) => route.fulfill({ json, status });
    if (endpoint === "/api/auth/providers")
      return respond({
        providers: { google: true, github: true },
        dev_login: true,
      });
    if (endpoint === "/api/auth/me")
      return respond(
        state.authenticated
          ? { authenticated: true, user: state.user, session: state.session }
          : { authenticated: false, user: null },
      );
    if (endpoint.startsWith("/api/auth/login/")) {
      state.logins.push(url.pathname + url.search);
      state.authenticated = true;
      state.session = metadata();
      return route.fulfill({
        status: 302,
        headers: { location: `${base}/?auth=success` },
      });
    }
    if (endpoint === "/api/auth/dev-login") {
      state.logins.push(url.pathname + url.search);
      state.authenticated = true;
      state.session = metadata();
      return respond({ authenticated: true, user: state.user, session: state.session });
    }
    if (endpoint === "/api/auth/session") {
      const body = request.postDataJSON();
      state.choices.push(body.remember);
      assert.equal(request.headers()["x-nexora-session-intent"], "update");
      if (state.holdChoice)
        await new Promise((resolve) => {
          state.releaseChoice = resolve;
        });
      if (!state.authenticated) return respond({}, 401);
      if (state.failChoice-- > 0)
        return respond({ detail: "Fixture failure" }, 503);
      state.session = {
        ...state.session,
        expires_at: new Date(Date.now() + (body.remember ? 30 * 24 : 12) * 3600000).toISOString(),
        remembered: body.remember,
        choice_pending: false,
      };
      return respond({ session: state.session });
    }
    if (endpoint === "/api/auth/logout") {
      if (state.failLogout-- > 0) return respond({}, 503);
      state.authenticated = false;
      return respond({ authenticated: false });
    }
    if (endpoint === "/api/auth/profile") return respond({ user: state.user });
    if (endpoint === "/api/auth/onboarding")
      return respond({
        tours: [
          { tour_id: "core", version: 1, step_index: 8, status: "completed" },
        ],
      });
    if (endpoint === "/api/notifications/count")
      return respond({ unread_count: 0 });
    if (endpoint === "/api/reports") return respond({ reports: [] });
    return respond({});
  });
  const open = async () => {
    const page = await context.newPage();
    activePage = page;
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await page.goto(base);
    return page;
  };
  return { context, state, open, vi: language === "vi" };
}
const retiredPrompt = (page) => page.locator(".login-session-dialog");
async function readyWithoutPrompt(page) {
  await page.locator(".user-menu-trigger").waitFor();
  assert.equal(await retiredPrompt(page).count(), 0, "No remember-login popup");
}
async function openSettings(page) {
  await page.evaluate(() => { location.hash = "#/profile"; });
  const settings = page.locator(".login-session-settings");
  await settings.waitFor();
  return settings;
}
const settingsButton = (settings, vi, remembered) =>
  settings.getByRole("button", {
    name: remembered
      ? vi ? "Tắt ghi nhớ đăng nhập" : "Stop remembering login"
      : vi ? "Ghi nhớ đăng nhập" : "Remember login",
    exact: true,
  });
async function shot(page, name) {
  if (!process.env.NEXORA_QA_OUTPUT) return;
  await mkdir(process.env.NEXORA_QA_OUTPUT, { recursive: true });
  await page.screenshot({
    path: path.join(process.env.NEXORA_QA_OUTPUT, `${name}.png`),
    fullPage: true,
  });
}
async function signOut(page, vi) {
  await page.getByRole("button", {
    name: vi ? "Mở menu tài khoản" : "Open account menu",
  }).click();
  await page.getByRole("button", {
    name: vi ? "Đăng xuất" : "Sign out", exact: true,
  }).click();
}
try {
  for (const [language, theme, provider] of [
    ["vi", "dark", "google"], ["en", "light", "github"],
  ]) {
    const f = await fixture(language, theme, false), page = await f.open();
    const signIn = page.getByRole("button", {
      name: `Continue with ${provider === "google" ? "Google" : "GitHub"}`,
    });
    await signIn.waitFor();
    assert.equal(await page.getByRole("checkbox").count(), 0, "No pre-login checkbox");
    await page.getByText(/automatically remembered for up to 30 days/).waitFor();
    await signIn.click();
    await readyWithoutPrompt(page);
    assert.deepEqual(f.state.logins, [`/api/auth/login/${provider}`]);
    assert.equal(f.state.session.remembered, true);
    assert.equal(f.state.session.choice_pending, false);
    assert.deepEqual(f.state.choices, [], "No follow-up preference request needed");
    await page.reload();
    await readyWithoutPrompt(page);
    assert.equal(f.state.logins.length, 1, "Reload does not start another OAuth flow");
    const settings = await openSettings(page);
    await settingsButton(settings, f.vi, true).click();
    await settingsButton(settings, f.vi, false).waitFor();
    assert.equal(f.state.session.remembered, false);
    await page.reload();
    await readyWithoutPrompt(page);
    await settingsButton(page.locator(".login-session-settings"), f.vi, false).waitFor();
    assert.deepEqual(f.state.choices, [false], "Explicit profile opt-out is not overridden on reload");
    await settingsButton(page.locator(".login-session-settings"), f.vi, false).click();
    await settingsButton(page.locator(".login-session-settings"), f.vi, true).waitFor();
    await shot(page, `auto-login-${language}-${theme}`);
    await signOut(page, f.vi);
    await page.locator(".login-shell").waitFor();
    await page.reload();
    await page.locator(".login-shell").waitFor();
    assert.equal(await retiredPrompt(page).count(), 0);
    assert.equal(f.state.logins.length, 1, "Logout must not automatically sign back in");
    await f.context.close();
  }
  {
    // A stale backend response from the previous release must not mount the
    // retired popup or block profile access. The new backend migrates it in /me.
    const f = await fixture(), page = await f.open();
    f.state.session = { ...metadata(), remembered: false, choice_pending: true };
    await page.reload();
    await readyWithoutPrompt(page);
    await openSettings(page);
    assert.deepEqual(f.state.choices, [], "No hidden client-side consent request");
    await f.context.close();
  }
  {
    const f = await fixture(), page = await f.open();
    await readyWithoutPrompt(page);
    const settings = await openSettings(page);
    f.state.failChoice = 1;
    await settingsButton(settings, true, true).click();
    await settings.getByRole("alert").waitFor();
    assert.equal(f.state.session.remembered, true, "Failed setting change preserves state");
    f.state.holdChoice = true;
    await settingsButton(settings, true, true).evaluate((button) => {
      button.click(); button.click();
    });
    await page.waitForFunction(() => document.querySelector(".login-session-settings button")?.disabled);
    assert.deepEqual(f.state.choices, [false, false], "Double click produces only one in-flight request");
    assert.ok(f.state.releaseChoice);
    f.state.releaseChoice();
    await settingsButton(settings, true, false).waitFor();
    f.state.failLogout = 1;
    await signOut(page, true);
    await page.getByText("Chưa đăng xuất được. Kiểm tra kết nối và thử lại.").waitFor();
    assert.equal(await page.locator(".login-shell").count(), 0, "Logout failure is not reported as success");
    await signOut(page, true);
    await page.locator(".login-shell").waitFor();
    await f.context.close();
  }
  {
    const f = await fixture(), first = await f.open(), second = await f.open();
    await readyWithoutPrompt(first); await readyWithoutPrompt(second);
    const firstSettings = await openSettings(first), secondSettings = await openSettings(second);
    await settingsButton(secondSettings, true, true).click();
    await settingsButton(secondSettings, true, false).waitFor();
    await first.bringToFront();
    await settingsButton(firstSettings, true, false).waitFor();
    await signOut(second, true);
    await second.locator(".login-shell").waitFor();
    await first.bringToFront();
    await first.locator(".login-shell").waitFor();
    await f.context.close();
  }
  {
    const f = await fixture(), page = await f.open();
    await page.setViewportSize({ width: 390, height: 844 });
    await readyWithoutPrompt(page);
    const settings = await openSettings(page);
    await settingsButton(settings, true, true).waitFor();
    const bounds = await settings.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391, "Profile controls fit mobile viewport");
    await shot(page, "auto-login-mobile");
    await f.context.close();
  }
  {
    const f = await fixture("vi", "dark", false), page = await f.open();
    await page.getByRole("button", { name: /Use local development account/ }).click();
    await readyWithoutPrompt(page);
    assert.deepEqual(f.state.logins, ["/api/auth/dev-login"]);
    assert.equal(f.state.session.remembered, true);
    await signOut(page, true);
    await page.locator(".login-shell").waitFor();
    await page.getByRole("button", { name: /Use local development account/ }).click();
    await readyWithoutPrompt(page);
    assert.equal(f.state.session.remembered, true, "A fresh login automatically remembers again");
    assert.deepEqual(f.state.choices, []);
    await f.context.close();
  }
  {
    const f = await fixture(), page = await f.open();
    await readyWithoutPrompt(page); await openSettings(page);
    await page.locator(".profile-identity-card").waitFor();
    f.state.user = { ...user, id: "google:another-account", name: "Another account", public_name: "Another account" };
    const navigated = page.waitForEvent("framenavigated", { predicate: frame => frame === page.mainFrame() });
    await page.evaluate(() => window.dispatchEvent(new StorageEvent("storage", {
      key: "nexora-login-session-changed", newValue: "fixture-account-switch",
    })));
    await navigated;
    await page.locator(".user-menu-trigger").getByText("Another account", { exact: true }).waitFor();
    assert.equal(await page.locator(".profile-identity-card").getByText("QA Researcher", { exact: true }).count(), 0);
    await readyWithoutPrompt(page);
    await f.context.close();
  }
  {
    const f = await fixture(), page = await f.open();
    await readyWithoutPrompt(page);
    f.state.authenticated = false;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.locator(".login-shell").waitFor();
    assert.equal(f.state.logins.length, 0, "Expired sessions require an explicit fresh sign-in");
    await f.context.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(dialogs, [], "No native browser confirmation");
  console.log("PASS: automatic Google/GitHub/local login, no popup, reload, legacy response, profile opt-out, errors, duplicate protection, cross-tab logout/account switch, expiry and mobile.");
} catch (error) {
  if (activePage && !activePage.isClosed()) await shot(activePage, "auto-login-failure");
  throw error;
} finally {
  await browser.close();
}
