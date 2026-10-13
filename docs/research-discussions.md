# Group projects, conversations, and meetings

## Product behavior

- Groups have a left-side workspace: Projects, Group discussion, Meetings & minutes, Members & settings. Group projects are returned by the server after authorization filtering. Creating a project here passes the selected group explicitly; Fields notebooks remain personal.
- Projects use the existing full-screen editor workspace. Discussion and Meetings are left-side tools; switching tools preserves editor tabs, scroll and unsent chat/form drafts in memory. A grouped project links back to its group space.
- Group chat and project chat are separate durable channels. Project conversations can attach an existing project page or shared evidence record. They never read private Library notes automatically. Page comments remain separate, position-specific review tools.
- Text is rendered literally, not as executable HTML. Threads are one level deep; a deleted root keeps its replies. Authors edit their own messages; managers can remove others' messages. Pins are limited to 20 per channel and require manager access in groups or editor access in projects.
- Explicit @mention selection and replies to a root author create inbox notifications. Ordinary messages do not notify every member. Channel mute also suppresses meeting notices; account-level collaboration preferences and blocks still apply. A read marker is monotonic and marks the channel **including its threads** through a known server cursor.
- Project editors can turn a message into one unassigned task and one notebook page. Repeating conversion returns the existing item. Notes quote the text with attribution; project activity stores the originating message ID. Group messages do not silently choose a project for conversion.
- Meetings have timezone-aware start/end times (maximum eight hours), optional public HTTPS room links, agenda, minutes, RSVP, and an `.ics` export. Organizers or managers edit/cancel; cancellation keeps minutes. Viewers may RSVP while the project is not archived. There is no built-in voice/video, recording, attachment upload, DM, or AI chat summary in this version.

## Privacy and authorization

Every read/write rechecks the current account and group/project access. A page-only guest cannot enter the project channel. A regular group member cannot enter a restricted project's channel without an explicit project grant. Leaving/removal from a group invalidates its project grants until membership is regained. Archiving a group blocks all its channels; restoring re-enables them. An archived project preserves read-only history and disables chat/meeting mutations and RSVP.

Notification serialization rechecks access and redacts actor/title/destination when unavailable. The browser clears channel history and drafts on access/session denial. API responses use `private, no-store`. Existing account session/CORS settings still need correct production configuration.

Blocking hides that person's chat bodies, mentions and notifications but does not itself revoke an explicit collaboration grant. Existing group/meeting membership metadata is governed by group/project permissions, not friendship. An external meeting URL is never fetched by the backend; opening it takes the user to that external provider. Local IPs, localhost, credentials, non-HTTPS schemes and invalid time ranges are rejected.

## Persistence and deployment

Tables are added idempotently by the existing SQLite initialization under its schema lock; existing data is not deleted. Messages, preferences, conversions, meetings and RSVP persist in the configured `AUTH_DATABASE_PATH`. Writes use transactions. Message and meeting creates carry client IDs for safe retries; content changes cannot reuse an already-saved request ID. Message/meeting edits check `expected_version` and return 409 on a conflict, with an explicit UI option to reload the latest version rather than silently overwrite.

Production must persist the database on the backend's durable storage (including its existing backup plan). Deploying the frontend alone does not install these API routes. No new paid provider, GPU, model call, or schema-reset command is required.

## Update transport and limits

This version uses **5-second HTTP polling while a panel is visible**, not WebSocket push. Hidden panels/background tabs pause; re-opening a tool refreshes immediately. A latest page is bounded to 40 messages by default (API maximum 100). The UI retains at most 200 loaded messages per list; narrow older history with search. Loaded history is revalidated too, so old blocked/deleted/edited messages do not linger outside the newest page. Meeting history is cursor-paginated by immutable creation order, not random IDs or editable schedule times.

There are no model calls per message and no process-local relay. This works across backend workers sharing the same database. Polling still consumes HTTP/database capacity; measure actual concurrency before adding a broker/WebSocket layer. `chat.*` is limited to 30 actions per user per minute; meeting creation/editing uses the existing 10/minute limit. Search supports Unicode casefold matching; it is a bounded-result SQLite scan, not a whole-web search or large-scale full-text service.

## Verification

`tests/test_discussions.py` uses an isolated temporary database. It covers access roles, restricted projects, page guests, group removal/archive/restore, cache redaction, mentions/blocks/mute, retries/concurrency, threads/cursors, edit conflicts, conversions, meetings/RSVP and URL/time validation.

`frontend/tests/discussion.test.mjs` checks merging, links, localized errors and UTF-8-safe calendar export. `frontend/tests/discussions.browser.mjs` uses the entirely in-memory `projects.html` fixture; it never writes to real accounts. The existing project workspace browser regression suite also runs, including pending-edit confirmation, editor continuity and permissions.
