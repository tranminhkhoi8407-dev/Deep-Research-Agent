# Project writing workspace

Projects now open a full-height workspace using the same block editor and visual
surfaces as Fields. The Projects/Groups/Friends/Invitations hub remains the entry
point; those global controls are not repeated above each document.

## Layout and behavior

- Left sidebar: project identity, project-scoped search, collapsible project tools
  (Overview, Pages, Tasks, Evidence, Members, Activity, Details), favorites and
  nested pages. Library, editor guide, archived pages, friends/notifications and
  account preferences live below the page tree.
- Document header: workspace tabs, breadcrumb, Edited/Updates/Analytics, Share,
  Copy link, favorite and page menu. No horizontal project-tools tab bar.
- The sidebar supports pointer resizing, keyboard resizing and Ctrl+Backslash.
  Its width/collapse preference is shared with Fields and scoped by account.
  On small screens it becomes a dismissible drawer; background controls are inert.
- Switching project tools keeps the current editor mounted, including its live
  connection, and restores document scroll. Visited utility forms remain mounted,
  preserving unsaved Tasks/Evidence/Details input during in-workspace switches.
- Tabs have independent histories. Closing the final tab opens Overview rather
  than recreating it. The new-tab picker includes only this project's pages.
- Page menus support favorite, rename, icon, duplicate, move, sibling ordering,
  side peek, and branch archive as authorized. Creation explicitly distinguishes
  top-level pages from children. General project child pages are also listed
  below the parent editor without silently changing existing CRDT document content.
- Pending document saves or an unsaved title trigger confirmation before switching
  documents or following sidebar links out of the workspace. Existing editor
  session-draft recovery remains in use. A successful write is not inferred merely
  from leaving a page. Title changes from the page menu are reflected immediately.
- Per-account/per-project session memory stores tabs, selected page, scroll offsets,
  tree collapse and tool collapse. Restored IDs are checked against current access.
  Form drafts are not promised to survive reload or changing projects.

## Access boundaries

Project membership is checked independently of direct page invitations. A person
with only a page invitation receives a page-only workspace; it does not fetch the
project details, disclose its page tree/evidence/tasks or offer project tools.
Viewer/commenter/editor/manager permissions still come from the backend, not the
presence or absence of buttons. Settings and branch archive require manager access.
Field home pages remain protected. Personal Fields and project spaces are not merged.

Project details expose the public owner profile, current viewer's page preferences,
per-page effective access and the protected Field home ID when applicable. Favorites
and last-opened state belong to the viewer, not all project members.

Access is rechecked on route loads, visible-page polling and focus. Revocation clears
the tree, cached utility views and tabs; a surviving direct page grant falls back to
page-only mode. Late responses from a previous editor must not clear a new page.
Transient loading failures support retry, without automatically discarding an already
open editor. This is not a guarantee of instantaneous cross-client revocation.

## Routes

Existing links remain valid:

- `#/collab` — global collaboration hub.
- `#/collab/project/<32-hex-id>` — project Overview.
- `#/collab/page/<32-hex-id>` — authorized document.
- `#/collab/project/<id>?view=tasks&page=<page-id>` — tool view retaining editor context.

Other tool values: `evidence`, `members`, `activity`, `settings`, `archived` and
`overview`. Helpers validate IDs and reject unknown/duplicate parameters.

## Verification

Backend: `python -m pytest -q` in the virtual environment.

Frontend: `node --test tests/*.test.mjs` and `npm run build` in `frontend`.

Browser regression: start the frontend dev server, install/provide Playwright and a
browser, then run `npm run test:projects:browser`. Optional environment variables:

- `NEXORA_TEST_URL` — dev-server origin (default `http://127.0.0.1:5173`).
- `NEXORA_PLAYWRIGHT_DIR` — module directory containing Playwright if not local.
- `NEXORA_BROWSER_EXECUTABLE` — installed Chromium/Edge executable if needed.
- `NEXORA_QA_OUTPUT` — optional screenshot directory.

The test-only Vite entrypoint under `frontend/tests/fixtures/` uses in-memory API and
live-editor responses. It does not access a real user's projects, send invitations,
or mutate production data. Normal production builds use `frontend/index.html`, not
the fixture. Browser checks cover actual editor continuity, form/scroll retention,
tabs, pending-edit navigation, side peek, create/rename/archive payloads, sharing,
permissions, retry, revocation and 320–1440px layouts. Backend tests enforce the real
permission and preference boundaries independently of these mock browser responses.

Overview always exposes **Add page** to project editors/managers, including projects
that already have pages. Each root row offers a separate **Add subpage** action.
Readers cannot create pages. Row icons have a fixed footprint; titles align left
and can wrap, independently of whether the icon is an emoji or document outline.
Pending invitations use text-sized Cancel buttons instead of icon-button widths.

The group creation form is separate from managing an existing group. A new group
requires a trimmed 2–80 character name, not two existing members. Validation is also
enforced by the backend. Failed creation retains the draft and shows a local error;
successful creation selects the new group and shows its own details. Double submits
are guarded, and a failed list refresh after a successful create is not reported as
a failed creation. Browser fixtures cover these error paths without creating real groups.

Group management confirmations (archive, leave, remove a member and transfer ownership)
use Nexora's themed in-app dialog, not a browser confirm popup. The archive prompt
names the group, explains that its projects and shared pages become unavailable,
and clarifies that the data is preserved and the owner can restore it. Cancel,
Escape or leaving the group view sends no mutation. Initial focus is on Cancel;
Tab/Shift+Tab remain inside the dialog. Each dialog has unique accessibility IDs.
Failed archives leave the group visible for retry; successful archives clear the
old group URL and keep the archived-groups recovery action available.

This phase does not add public publishing, a paper/PDF location viewer, tasks linked
to individual editor blocks, or a new review/approval workflow. Existing project
utilities and editor behavior are retained; those integrations need a separate scope.
