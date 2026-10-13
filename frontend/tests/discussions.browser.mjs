/* In-memory fixtures only. Never sends messages to real user accounts. */
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
const base = process.env.NEXORA_TEST_URL || "http://127.0.0.1:5173",
  pid = "a".repeat(32),
  gid = "e".repeat(32),
  errors = [],
  dialogs = [];
let activePage;
const open = async (query, hash) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  activePage = page;
  page.on("pageerror", (reason) => errors.push(reason.message));
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await page.goto(`${base}/tests/fixtures/projects.html?${query}${hash}`);
  return page;
};
const shot = async (page, name) => {
  if (!process.env.NEXORA_QA_OUTPUT) return;
  await mkdir(process.env.NEXORA_QA_OUTPUT, { recursive: true });
  await page.screenshot({
    path: path.join(process.env.NEXORA_QA_OUTPUT, name + ".png"),
    fullPage: true,
  });
};
const projectTool = (page, name) =>
  page
    .getByRole("navigation", { name: "Tiện ích dự án" })
    .getByRole("button", { name, exact: true });
try {
  for (const language of ["vi", "en"]) {
    const vi = language === "vi",
      page = await open(
        `groups=1&groupRole=owner&lang=${language}&theme=${vi ? "dark" : "light"}`,
        `#/collab/group/${gid}`,
      );
    const groupTools = page.getByRole("navigation", {
      name: vi ? "Tiện ích nhóm" : "Group tools",
    });
    await page.locator(".group-project-list > button").waitFor();
    assert.match(
      await page.locator(".group-project-list").innerText(),
      /FINER-SQL/,
    );
    const menu = await groupTools.boundingBox(),
      body = await page.locator(".group-space-content").boundingBox();
    assert.ok(menu.x < body.x, "Group utilities should be on the left");
    await shot(page, `group-projects-${language}`);
    await groupTools
      .getByRole("button", {
        name: vi ? "Thảo luận chung" : "Group discussion",
        exact: true,
      })
      .click();
    const chat = page.locator(".discussion-space").first();
    await chat.locator(".discussion-message").first().waitFor();
    await chat
      .locator(".discussion-composer textarea")
      .fill("Ý tưởng cho nhóm: review paper vào thứ năm.");
    await chat
      .getByRole("button", { name: vi ? "Gửi" : "Send", exact: true })
      .click();
    await chat
      .getByText("Ý tưởng cho nhóm: review paper vào thứ năm.", { exact: true })
      .waitFor();
    assert.equal(
      await chat
        .getByRole("button", {
          name: vi ? "→ Nhiệm vụ" : "→ Task",
          exact: true,
        })
        .count(),
      0,
      "Group messages do not silently choose a project for conversion",
    );
    await groupTools
      .getByRole("button", {
        name: vi ? "Lịch họp & biên bản" : "Meetings & minutes",
        exact: true,
      })
      .click();
    const meetings = page.locator(".meetings-panel");
    await meetings
      .getByRole("button", {
        name: vi ? "Lên lịch họp" : "Schedule meeting",
        exact: true,
      })
      .click();
    const form = meetings.locator(".meeting-form");
    await form
      .getByRole("textbox", {
        name: vi ? "Tên cuộc họp" : "Meeting title",
        exact: true,
      })
      .fill("FINER-SQL review");
    await form
      .getByRole("textbox", {
        name: vi ? "Agenda / nội dung cần bàn" : "Agenda / discussion topics",
        exact: true,
      })
      .fill("So sánh reward và ablation.");
    await form
      .getByRole("textbox", {
        name: vi
          ? "Biên bản / quyết định / việc tiếp theo"
          : "Minutes / decisions / next steps",
        exact: true,
      })
      .fill("Quyết định: đọc bảng benchmark trước.");
    await page.evaluate(() => {
      window.projectQA.failMeetingSaves = 1;
    });
    await form
      .getByRole("button", {
        name: vi ? "Lưu cuộc họp" : "Save meeting",
        exact: true,
      })
      .click();
    await meetings.getByRole("alert").waitFor();
    assert.equal(
      await form
        .getByRole("textbox", {
          name: vi ? "Tên cuộc họp" : "Meeting title",
          exact: true,
        })
        .inputValue(),
      "FINER-SQL review",
    );
    await form
      .getByRole("button", {
        name: vi ? "Lưu cuộc họp" : "Save meeting",
        exact: true,
      })
      .click();
    await meetings.locator(".meeting-card").waitFor();
    await meetings
      .getByRole("button", { name: vi ? "Có thể" : "Maybe", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        !!document.querySelector('.meeting-card button[aria-pressed="true"]') &&
        document
          .querySelector('.meeting-card button[aria-pressed="true"]')
          .textContent.match(/Có thể|Maybe/),
    );
    await meetings
      .getByRole("button", {
        name: vi ? "Hủy cuộc họp" : "Cancel meeting",
        exact: true,
      })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: vi ? "Hủy" : "Cancel", exact: true })
      .click();
    assert.equal(
      await meetings.locator(".meeting-card.is-cancelled").count(),
      0,
    );
    await shot(page, `group-meetings-${language}`);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        `Meeting layout at ${width}px`,
      );
    }
    await shot(page, `group-meetings-mobile-${language}`);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await groupTools
      .getByRole("button", {
        name: vi ? "Dự án của nhóm" : "Group projects",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", {
        name: vi ? "Tạo dự án trong nhóm" : "Create group project",
        exact: true,
      })
      .click();
    await page
      .locator(".group-space .meeting-form")
      .getByRole("textbox", {
        name: vi ? "Tên dự án" : "Project name",
        exact: true,
      })
      .fill("Group reproduction project");
    await page
      .getByRole("button", {
        name: vi ? "Tạo và mở dự án" : "Create and open project",
        exact: true,
      })
      .click();
    await page.waitForURL(new RegExp(`#/collab/project/${pid}`));
    const request = await page.evaluate(() =>
      window.projectQA.requests.find(
        (r) => r.path === "/projects" && r.method === "POST",
      ),
    );
    assert.equal(request.query, `?group_id=${gid}`);
    assert.equal(request.body.visibility, "group");
    await page.context().close();
  }
  const page = await open(
      "lang=vi&theme=dark",
      `#/collab/project/${pid}?view=discussion`,
    ),
    chat = page.locator(".discussion-space");
  await chat.locator(".discussion-message").first().waitFor();
  await chat
    .locator(".discussion-composer textarea")
    .fill("Cần kiểm tra 32 training rollouts.");
  await chat.locator(".discussion-composer summary").click();
  await chat.getByRole("checkbox", { name: "123", exact: true }).check();
  await chat
    .locator(".discussion-composer select")
    .selectOption("page:" + "b".repeat(32));
  await page.evaluate(() => {
    window.projectQA.failChatAfterSave = 1;
  });
  await chat.getByRole("button", { name: "Gửi", exact: true }).click();
  await chat.getByRole("alert").waitFor();
  assert.match(
    await chat.locator(".discussion-composer textarea").inputValue(),
    /32 training/,
  );
  await chat.getByRole("button", { name: "Gửi", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector(".discussion-composer textarea")?.value === "",
  );
  const sends = await page.evaluate(() =>
    window.projectQA.requests.filter(
      (r) => r.path.endsWith("/messages") && r.method === "POST",
    ),
  );
  assert.equal(sends.length, 2);
  assert.equal(sends[0].body.client_id, sends[1].body.client_id);
  assert.deepEqual(sends[0].body.mention_ids, ["fixture-recipient"]);
  const own = chat
    .locator(".discussion-history .discussion-message")
    .filter({ hasText: "32 training" });
  assert.equal(await own.count(), 1);
  await own.getByRole("button", { name: /Thread/ }).click();
  await chat.locator(".discussion-thread").waitFor();
  await chat
    .locator(".discussion-composer textarea")
    .fill("30 inference candidates là cấu hình khác.");
  await chat.getByRole("button", { name: "Gửi", exact: true }).click();
  await chat
    .locator(".discussion-thread")
    .getByText("30 inference candidates là cấu hình khác.", { exact: true })
    .waitFor();
  await shot(page, "project-thread-vi");
  await chat.getByRole("button", { name: "Đóng thread", exact: true }).click();
  await own.getByRole("button", { name: "Ghim", exact: true }).click();
  await chat.locator(".discussion-pins").waitFor();
  await own.getByRole("button", { name: "Sửa", exact: true }).click();
  await own
    .locator(".discussion-inline-edit textarea")
    .fill("Đã kiểm tra: 32 training rollouts.");
  await own.getByRole("button", { name: "Lưu", exact: true }).click();
  await own
    .getByText("Đã kiểm tra: 32 training rollouts.", { exact: true })
    .waitFor();
  await own.getByRole("button", { name: "→ Nhiệm vụ", exact: true }).click();
  await chat.locator(".discussion-convert input").fill("Rerun ablation");
  await chat
    .locator(".discussion-convert")
    .getByRole("button", { name: "Tạo", exact: true })
    .click();
  await projectTool(page, "Việc cần làm").click();
  await page.getByText("Rerun ablation", { exact: true }).waitFor();
  const getCount = () =>
    page.evaluate(
      () =>
        window.projectQA.requests.filter(
          (r) => r.path.startsWith("/discussions/") && r.method === "GET",
        ).length,
    );
  await page.waitForTimeout(200);
  const count = await getCount();
  await page.waitForTimeout(5500);
  assert.equal(await getCount(), count, "Hidden chat should not keep polling");
  await projectTool(page, "Thảo luận").click();
  await own.waitFor();
  await chat.locator(".discussion-composer textarea").fill("Bản nháp chưa gửi");
  await projectTool(page, "Việc cần làm").click();
  await projectTool(page, "Thảo luận").click();
  assert.equal(
    await chat.locator(".discussion-composer textarea").inputValue(),
    "Bản nháp chưa gửi",
  );
  await chat
    .getByRole("button", { name: "Tắt thông báo", exact: true })
    .click();
  await chat
    .getByRole("button", { name: "Bật thông báo", exact: true })
    .waitFor();
  await chat
    .getByRole("button", { name: "Đánh dấu đã đọc", exact: true })
    .click();
  await chat.getByText("0 chưa đọc", { exact: true }).waitFor();
  await chat
    .getByRole("textbox", { name: "Tìm tin nhắn", exact: true })
    .fill("32");
  await chat.getByRole("button", { name: "Tìm", exact: true }).click();
  await own.waitFor();
  await chat.getByRole("button", { name: "Xóa tìm kiếm", exact: true }).click();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 850 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `Chat layout at ${width}px`,
    );
  }
  await shot(page, "project-chat-mobile");
  await page.evaluate(() => {
    window.projectQA.mode = "revoked";
  });
  await page.waitForTimeout(5600);
  assert.equal(
    await page
      .getByText("Đã kiểm tra: 32 training rollouts.", { exact: true })
      .count(),
    0,
    "Revocation clears cached messages",
  );
  await page.context().close();
  const viewer = await open(
    "lang=vi&mode=viewer",
    `#/collab/project/${pid}?view=discussion`,
  );
  await viewer.locator(".discussion-message").waitFor();
  assert.equal(await viewer.locator(".discussion-composer").count(), 0);
  assert.equal(
    await viewer
      .getByRole("button", { name: "→ Nhiệm vụ", exact: true })
      .count(),
    0,
  );
  await viewer.context().close();
  assert.deepEqual(errors, []);
  assert.deepEqual(dialogs, []);
  console.log(
    "PASS: Group projects/create, text chat/thread/mention/pin/edit/tasks, idempotent retry, draft preservation, hidden polling, mute/read/search/revocation, meetings/RSVP/failure recovery/in-app cancel, bilingual light/dark/mobile layouts.",
  );
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await shot(activePage, "failure");
    console.error(
      await activePage.evaluate(() => ({
        url: location.hash,
        text: document.body.innerText.slice(-2500),
        requests: window.projectQA.requests.slice(-10),
      })),
      errors,
    );
  }
  throw error;
} finally {
  await browser.close();
}
