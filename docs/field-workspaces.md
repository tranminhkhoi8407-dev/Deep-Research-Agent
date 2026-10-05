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
