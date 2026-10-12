# In-app notifications and friends

## User experience

- Friends and the notification bell are next to the account controls, including the standalone field notebook header.
- Friends has five lists: accepted friends, received requests, sent requests, username search, and the user's own blocks.
- Search uses unique public usernames, never email. Requests in opposite directions remain pending until explicitly accepted.
- Friends can invite each other into groups/projects/pages the sender can manage. Viewer is the default direct-share permission; group invitations use member.
- The inbox supports all/unread, category filters, read/unread, snapshot-bounded mark-all-read, archive, pagination, and per-category preferences.
- Reading or archiving a notification does not accept or cancel the underlying invitation. Muting a category does not remove its requests from Friends/Invitations.
- Text is localized when displayed, not stored in one UI language.

## Scope of this release

Events: friend request received/accepted, group/project/page invitation received/accepted, and task assigned. Research completion, structured mentions/replies, email, and browser push are not implemented by this release. There is no LLM call in the social/notification path.

## Persistence and consistency

`backend/notifications.py` contains recipient-owned notifications, category preferences, independently directed blocks, persisted rate counters, and a one-time legacy migration. It uses the existing account database.

Domain writes and notifications share the same SQLite transaction. The recipient/event-key unique constraint suppresses duplicate occurrences. The database inbox is the delivery mechanism; no unreliable best-effort socket is required to receive an event.

The shell polls the count every 20 seconds while visible and refreshes on focus, visibility restoration, and local social actions. Open panels refresh from the same tick. This is in-app updating, not out-of-browser delivery or instantaneous cross-device push.

Mark-all-read takes the `through` sequence from an inbox snapshot. An event arriving after that snapshot stays unread. Inbox pages use descending sequence cursors, not offsets.

Notifications resolve the current relationship/invitation and resource access on every read. Missing, revoked, blocked, inactive or expired items do not expose private titles or actionable links. Notification responses revalidate the original request occurrence within the domain write transaction, so a cancelled/resent invitation cannot be accepted through an old notification.

Legacy blocks are imported once, pending notifications are seeded once, and old pending requests are normalized for occurrence checks. Migration neither restores friendship on unblock nor revives blocked pending invitations.

## Safety rules

- Friendship never grants content access.
- Only the sender can cancel a pending friendship request; only its recipient can accept/decline it.
- Each block belongs to its blocker. Removing one direction cannot remove the other person's block. Connection deletion cannot remove blocks.
- Blocking ends the friendship and pending direct invitations, not existing group membership or explicit project/page grants. The UI warns that permission revocation is separate.
- Unblocking does not restore friendship or invitations.
- Duplicate/crossing friend requests are idempotent and never auto-accept.
- Cancellation checks the UI's expected state. A stale Cancel request cannot silently unfriend someone who just accepted.
- Friend requests: 10/minute and 30/day per sender, 10-minute resend cooldown after cancellation, at least 24 hours after decline to the same recipient.
- Collaboration invitations: 10/minute and 100/day per sender. Username searches: 60/minute. Counters survive application-process restarts.
- The notification APIs derive the recipient from the authenticated session. They do not accept a client-selected account ID.

## API

- `GET /api/notifications`: `before`, `limit` (1–100), `unread`, `category`; returns items, unread count, snapshot cutoff and next cursor.
- `GET /api/notifications/count`
- `POST /api/notifications/read-all`: `{through}`
- `PATCH /api/notifications/{id}`: `{action: read|unread|archive}`
- `POST /api/notifications/{id}/respond`: `{action: accept|decline}`
- `GET/PUT /api/notifications/preferences`: friends, collaboration, tasks booleans.
- `GET /api/collab/blocks`
- `POST/DELETE /api/collab/people/{id}/block`
- Existing connection/invitation endpoints retain their paths; response endpoints optionally accept `expected_created_at` to guard stale UI occurrences.
- Connection deletion optionally takes `expected_status` and `expected_created_at`; the new UI sends both.

## Verification

`tests/test_notifications.py` exercises real authenticated API requests, ownership, duplicate and crossing requests, concurrent invitations, block bypass regression, legacy migration, read-state persistence across clients, preference isolation, cursor pagination, read-all cutoffs, rollback, stale invitations, and revocation redaction. Existing collaboration permission tests still apply.

`frontend/tests/social.test.mjs` checks relationship actions, safe destinations, localized labels, unavailable-content redaction, and relative times. Browser layout checks use synthetic fixtures, never real invitations from a user's account.

## Hosting caveat

Persistence only lasts as long as the underlying database volume. The repository's Render Free preview has an ephemeral filesystem. A durable database/storage deployment is required before relying on this feature for real users; these code changes do not configure a new hosting service or deploy it.
