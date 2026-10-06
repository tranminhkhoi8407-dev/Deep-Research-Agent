# Field research workspaces

## Navigation and layout

The Fields gallery navigates to each discipline in the current browser tab. The editor is a
standalone, full-height workspace without the website header, product navigation,
footer, or floating tour launcher. It retains its own page toolbar and collapsible
sidebar. The sidebar provides field switching, search, favorites, recent pages,
the page tree, archived pages, the workspace tour, and account preferences.

Supported home routes:

- `#/fields/mathematics`
- `#/fields/physics`
- `#/fields/chemistry`
- `#/fields/biology`
- `#/fields/artificial-intelligence`

A page deep link is `#/fields/{field}/page/{page_id}`. Home routes and deep links
work after reload and after the required profile-name setup. Internal navigation
to Nexora, the paper library, profile, and member management also uses this tab.
The gallery and sidebar link to `#/fields/guide`, a standalone editor handbook
with 65 searchable, copyable, rendered LaTeX examples: 15 basics and 10 per field.
The earlier field tools and local scratchpads remain at `#/fields/toolkit` for
compatibility; the old prominent toolkit link and gallery slogan are removed.

The Fields tour continues from the gallery into the editor in the same tab.
For an explicit Ctrl/Cmd-click or middle-click, a one-use account/field-bound
intent supports the user-chosen new tab, expires after ten minutes, and is removed
from the URL when consumed. Opening an ordinary field link does not restart a tour.
The tour waits for the loaded sidebar and opens it on mobile. The sidebar's
Workspace tour action is still available for replay/resume.

## Pages and editing

Opening a field creates exactly one personal notebook and home page per account
and discipline. The operation is transactional and idempotent even when two tabs
open simultaneously. It does not adopt, overwrite, or move earlier notebooks.

Users can create pages and arbitrarily nested subpages from the sidebar, the
page toolbar, the + on a page link, or the `/page` slash command. The fixed below-editor subpage list
and “A new idea” prompt are removed. Breadcrumbs follow
the hierarchy. Dragging a page onto another page nests it there; the Move menu is
the keyboard alternative. Cyclic and cross-project moves are rejected by the
server. Page actions include sibling ordering, favorites, a color cover, an icon,
full width, duplication, and reversible branch archival.

The sidebar's **New page** defaults to a root-level sibling of the field home.
The toolbar's **Subpage**, `/page`, and a page's `+` default to a child of that
specific page. Root siblings are not shown as children inside Mathematics (or
any of the other four homes). The parent selector makes this distinction explicit.

For personal field notebooks, direct children have Page blocks in the parent's
CRDT document. Creation, movement, duplication, trash and restoration update
those blocks in the same database transaction as the hierarchy. Removing the
last owned child block, including by keyboard deletion, trashes its active branch.
Undo restores only that operation's trash batch. Removing a reference to a root
sibling or another page does not trash or reparent the target. Existing missing
child blocks are repaired once without deleting or rearranging existing pages.
The realtime relay checks actual CRDT deltas, not the optional search projection,
and notifies open editors to refresh their page tree immediately. Page-only
editors cannot use a block deletion to bypass project-manager trash permissions.

Page blocks have their own searchable menu: icon, favorite, rename, open in a
tab/window/side peek, copy page link, duplicate, move and trash. Page icons are
shared with the sidebar, and page labels read current metadata. Turn into a text
block expands an owned child's document into the parent while retaining the
original in reversible trash. Ordinary block menus retain their real per-block
edit attribution and word/character counts. Page duplication still copies only
the selected document; links to its existing children remain references.

The editor reuses the existing BlockNote/Yjs synchronization, local pending-edit
recovery, LaTeX and data-table blocks, snapshots, citations, comments, and invitations.
Advanced templates, imports/exports, and research-brief preparation remain in Projects;
the extra research tools panel is not shown below the Fields writing canvas. These are real backend
operations, not a static layout. Duplicating copies only the selected page and
its document, not child pages, comments, history, or individual invitations.

The writing canvas has no permanent LaTeX/table toolbar. Hover a block for + and
the drag handle; type `/` for the searchable insertion menu. The drag-handle menu
supports Turn into (including Block equation), Color, Copy link to block,
Duplicate, Move up/down, and Delete, with searchable actions and a block-type
caption. Turn into → Page copies a block and descendants into a saved subpage
with fresh IDs, then replaces the unchanged original with a document link.
If concurrent edits arrive or saving fails, the original remains intact.
The menu footer counts the selected block's own words/Unicode characters and
retrieves its last editor/time from authenticated, durable CRDT update records.
Unrelated block edits, descendant edits and duplicate deliveries do not change
that attribution. Access is checked before even a cached activity lookup.
No fake AI, synced-block or multi-column actions are displayed.

The drag menu keeps its own scrollbar, while Turn into and Color render in
separate fixed-position portals. This prevents the main menu's overflow and size
boundary from clipping or shrinking their choices. The themed portal root is
attached to the document body and registered as editor UI, escaping the side
menu's transformed stacking context; each submenu is constrained to the viewport.
Pointer/touch/keyboard events
inside a submenu do not trigger the main menu's outside-click dismissal before
selection; clicks outside still dismiss it normally.

Typing `$$a^2+b^2=c^2$$` creates an inline equation upon the closing `$$`.
Use `/math` or `/equation` for a centered Block equation; click an equation to
edit its source. Currency signs and incomplete/escaped delimiters stay text;
code blocks are never converted. The built-in single-dollar and $$-space input
rules are disabled to avoid premature conversion. Markdown import retains
multiline display equations, recognizes double-dollar inline expressions, and
preserves code. Invalid LaTeX retains its source and shows an error preview.
Markdown exports preserve raw inline/display LaTeX using an export-only token
projection, rather than relying on the generic HTML exporter for custom math.

Interaction references: Notion's official [math equations](https://www.notion.com/help/math-equations)
and [writing/editing basics](https://www.notion.com/help/writing-and-editing-basics).
This implements the described writing workflow, not every Notion feature.

## Privacy and storage

The field editor has an internal tab strip (not browser tabs), with independent
back/forward stacks, close buttons and a searchable `+` picker. Tabs persist in
account-scoped session storage, up to 20 tabs and 50 history entries each. The
picker searches titles across the caller's personal field notebooks only, excludes
trash, shows an indexed text preview and can create a top-level page in a new tab.
Normal sidebar navigation replaces the selected tab's page. Tabs and drafts are
not shared across accounts. Local unacknowledged CRDT drafts recover on returning
to their page; tab changes do not discard them.

The header's Edited label opens Updates and Analytics. Updates combine durable
metadata events (including real before/after title changes) with content edits
grouped by authenticated author/minute. Up to 100 recent updates are displayed.
Analytics require edit access, have 7/28/90-day UTC ranges, daily total/unique
views, opted-in viewers and real creator/editor attribution. Visits begin being
tracked when this feature is installed; legacy visit counts are not fabricated.
Repeat visits by the same account within five minutes count once. Indexing,
previewing and polling are not visits. The active visible field page and shared
page destinations record visits. Viewer names are hidden by default. Turning
off per-page view history hides that person's historical identity too, while
aggregate counts remain. No IP, device fingerprint or browser-history collection
is used.

Share is connected to existing page invitations and roles, not a visual mock.
Managers can invite up to 20 registered unique names/emails at once, choose
view/comment/edit access, cancel pending invitations and change/remove direct
grants. Batch validation is atomic. Recipients accept invitations in the app;
outbound email is not configured. Project-inherited permissions cannot be revoked
by lowering a direct page grant. General access remains private/invited; public
Publish is not enabled. Copy link beside Share and inside its popover points to
the access-checked shared-page route and never creates an access grant. The
browser's reserved Ctrl+L shortcut is deliberately unchanged.

Interaction references: Notion's official
[page analytics](https://www.notion.com/help/page-analytics) and
[sharing and permissions](https://www.notion.com/help/sharing-and-permissions).

Personal notebooks are private initially. Existing project-member permissions
continue to apply. Direct page invitations grant access to that specific page,
not its children. Favorites and recently opened timestamps belong to the viewing
account. The field home cannot be archived or nested; its containing personal
project cannot be archived.

Archiving a page archives its active subtree in one batch. Restoring the parent
restores that batch but leaves previously archived descendants archived. Restore
the parent first if it is still archived.

This feature uses the existing SQLite storage. It does not add persistent cloud
storage or change the application's deployment configuration. Deploy the updated
backend and frontend together; schema additions are applied on backend startup.

## Verification

The sidebar can be dragged between 220–600px (also limited to leave 480px for
the canvas). Width and collapsed state are account-scoped local preferences;
Ctrl+\\ toggles it, and the separator supports arrow keys, Shift+arrows, Home,
End and Enter. Mobile keeps a separate drawer layout. Successful sync/presence
badges are removed; websocket synchronization, local draft recovery, saving
announcements for screen readers and visible failure alerts remain intact.

Share uses neutral themed Share/Publish tabs, an invitation row, real member
permissions, private general access, Advanced and Copy link. Publish explicitly
states that public publishing is not supported; it does not expose a notebook.
Missing API routes now report an outdated backend separately from denied or
archived pages. The local startup script reloads backend source changes to avoid
serving old routes alongside new frontend code.

Color regression: choose **Text → Yellow** on a paragraph, confirm the actual
text color (not only the selected checkmark), set a background independently,
then reload. Global typography and collaboration-card paragraph colors must not
override BlockNote block or inline styles in either theme.

Backend tests cover all five fields, separate accounts, concurrent creation,
metadata validation, hierarchy and access checks, batch archive/restore, per-user
preferences, and CRDT duplication. Frontend route tests cover homes, deep links,
profile returns, and cycle-safe hierarchy helpers. Browser checks cover navigation,
absence of website chrome, nested pages, saved content after reload,
cross-tab realtime updates, all five field notebooks, light/dark appearance, and
mobile sidebar navigation. The Fields tour supports the gallery-to-editor
transition, sidebar/writing/guide steps, Back, and Finish on a narrow viewport.
Equation checks include closing-dollar typing, inline/display conversion,
realtime synchronization, reload persistence, and raw-LaTeX Markdown projection.
Unit tests also cover expired/invalid tour intents, denied browser storage,
fresh IDs when duplicating nested blocks, and math export in nested/table content.
Formula tests render every handbook example with strict KaTeX validation.
Activity tests verify authenticated per-block authors, privacy, nested edits,
invalid identifiers, and idempotent update attribution.
Submenu regression checks use an isolated notebook: open Turn into and Color,
check the choices are visible outside the scrolling main menu, apply Heading 2
and a background color, and reload to verify both persist. Also check keyboard
selection, Escape/outside dismissal, and menus near viewport edges.
