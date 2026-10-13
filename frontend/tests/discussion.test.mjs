import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const source = await readFile(
  new URL("../src/discussion.ts", import.meta.url),
  "utf8",
);
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const {
  calendarFile,
  mergeMessages,
  safeMeetingLink,
  discussionError,
  discussionPath,
} = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
);
test("message snapshots replace changed versions without duplication or reordering", () => {
  assert.deepEqual(
    mergeMessages(
      [
        { id: "a", seq: 1, body: "old" },
        { id: "c", seq: 3 },
      ],
      [
        { id: "b", seq: 2 },
        { id: "a", seq: 1, body: "edited" },
      ],
    ),
    [
      { id: "a", seq: 1, body: "edited" },
      { id: "b", seq: 2 },
      { id: "c", seq: 3 },
    ],
  );
});
test("external meeting links reject executable schemes and credential leakage", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:text/plain,x",
    "http://meeting.example",
    "https://user:secret@meeting.example",
    "",
    "/relative",
  ])
    assert.equal(safeMeetingLink(value), null);
  assert.equal(
    safeMeetingLink("https://meet.google.com/abc"),
    "https://meet.google.com/abc",
  );
});
test("calendar exports have UTC time, escape injected lines, and UTF-8 folding", () => {
  const value = calendarFile({
    id: "a",
    title: "Buổi họp, nghiên cứu;".repeat(12),
    starts_at: "2026-10-15T14:00:00+07:00",
    ends_at: "2026-10-15T15:00:00+07:00",
    meeting_url: "https://meet.example.com",
    agenda: "Agenda\nBEGIN:VEVENT\nUnsafe, field; \\",
    status: "cancelled",
  });
  assert.match(value, /DTSTART:20261015T070000Z/);
  assert.match(value, /STATUS:CANCELLED/);
  assert.equal(
    value.split("\r\n").filter((line) => line === "BEGIN:VEVENT").length,
    1,
  );
  assert.ok(
    value.split("\r\n").every((line) => Buffer.byteLength(line, "utf8") <= 75),
  );
  assert.match(
    value.replace(/\r\n /g, ""),
    /DESCRIPTION:Agenda\\nBEGIN:VEVENT\\nUnsafe\\, field\\; \\\\/,
  );
});
test("channel paths and error states do not conflate chat limits with friend cooldown", () => {
  assert.equal(
    discussionPath({ kind: "group", id: "abc" }),
    "/discussions/spaces/group/abc",
  );
  assert.match(discussionError({ status: 429 }, true), /một phút/);
  assert.match(discussionError({ status: 409 }, true), /bản mới/);
  assert.match(discussionError({ status: 403 }, false), /unavailable/);
});
