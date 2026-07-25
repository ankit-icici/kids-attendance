# Attendance Star Chart

A kids' class-attendance tracker. A parent marks the days a child attended a class; the app counts attended days over any date range, shows them as a star reward-chart and a tappable calendar, supports multiple kids, and can sync live between two phones.

**If you are an AI assistant or developer reading this to help make changes: read this whole file first, then read `index.html`. This file is the memory of why the app is built the way it is. Everything is intentional; check here before changing anything that looks unusual.**

---

## The one hard rule behind every design decision

The owner needs this app to **outlive any single tool or service**. It must keep working even if the AI that built it disappears. That constraint drove every choice below. Preserve it:

- **It is a single, self-contained `index.html` file.** No build step, no framework, no bundler, no npm. Plain HTML + CSS + vanilla ES5-ish JavaScript in one file. Do not introduce a build pipeline or split it into modules unless the owner explicitly asks. Do not add external script/font/CDN dependencies — it must run offline from a local file.
- **Data lives on the device**, in `localStorage`, wrapped in try/catch so it degrades gracefully if storage is blocked.
- **Sync is optional and uses the owner's own cloud**, not any first-party/AI service (see Sync).

## What the app does (features, in order they were built)

1. **Count attended days.** Mark a class present on a given day; a counter increases. Marking is a toggle — the same day can never be counted twice (attendance is stored as a set of date keys).
2. **Date-range counting.** Presets: This month / Last 30 days / This year / All time / Custom (two date pickers). The big number on each class card is the count within the selected range; "all time" is shown small alongside.
3. **Recording date.** A bar lets you pick which day you're marking (default today), with prev/next arrows, a date picker, and a "Today" reset — so you can back-fill forgotten days.
4. **Multiple kids.** A horizontal avatar bar at top. Each kid has a name, an emoji "animal", and a color from a fixed palette. Selecting a kid re-themes the whole UI to that kid's color (CSS variables `--accent`, `--accent-soft`, `--kidc`). Kids can be renamed / recolored / deleted via the ✎ pencil.
5. **Star reward chart.** Each attended day in range renders as a star in the kid's color (capped at 30 shown, then "+N"). Marking a day triggers a small star-burst animation (respects `prefers-reduced-motion`).
6. **Calendar view.** Each class has a "Show calendar" toggle that renders month grids covering the selected range. Attended days are filled circles in the kid's color; today has a ring. **Tapping any day in the calendar toggles attendance for that exact date.** For "all time" the window is clamped to [earliest record .. today]; capped at 36 months shown.
7. **Backup / Restore.** Export all data to a JSON file (readable `{kids:[...]}` shape); restore replaces current data (and pushes to the shared space if sync is on). This is the owner's insurance against a lost/wiped phone.
8. **Live two-phone sync** (optional; see below).

## Data model

In-memory / rendered state (`state`):
```
{ kids: [ { id, name, emoji, color, soft, classes: [ { id, name, records: { "YYYY-MM-DD": true } } ] } ],
  activeKidId }
```
`activeKidId`, the recording date, the range selection, and which calendars are open are **per-device UI state** and are NOT synced.

Dates are handled as local `YYYY-MM-DD` strings (never `toISOString()`, to avoid timezone drift). String comparison works for range checks because the format is zero-padded and sortable.

## Sync architecture (read carefully before touching)

- Backend: **the owner's own Google Firebase Realtime Database**, accessed over plain REST with `fetch` (no Firebase SDK, to keep the single-file/offline property). Config (database URL + a shared "space code") is entered by the user in-app and stored in `localStorage` under `att.sync.v3`. **The config is never stored in this repo and must never be committed. Do not paste real Firebase URLs or space codes into any file here.**
- Canonical local data is a **tree** (`localTree`) that mirrors the Firebase JSON shape:
  ```
  spaces/<code>/
    meta/seeded = true                                 // "this space was set up on purpose"
    meta/kids/<kidId> = { name, emoji, color, soft, order, classes: { <classId>: { name, order } } }
    records/<kidId>/<classId>/<YYYY-MM-DD> = true      // absence = key removed
    devices/<deviceId> = { name, ts }                  // presence heartbeat, NOT data
  ```
  `localTree` holds only `meta` and `records`. `devices` is presence bookkeeping
  and is deliberately kept out of the local tree, out of backups, and out of the
  op queue.
  `state` is derived from `localTree` via `treeToState()` for rendering; `stateToTree()` goes the other way (used for backup restore / seeding a new space).
- **Every mutation is expressed as one or more REST "ops"** (`opMarkDay`, `opAddKid`, `opEditKid`, `opDeleteKid`, `opAddClass`, `opRenameClass`, `opDeleteClass`). `applyOps()` applies each op to `localTree` locally AND (if sync is on) queues it and flushes it to Firebase. Because each op targets a **specific leaf path** (e.g. one day, one class), concurrent edits from two phones do **not** clobber each other — this is the key correctness property. Do not replace this with whole-document last-write-wins.
- Offline edits are queued in `localStorage` (`att.queue.v3`) and flushed on reconnect; ops are idempotent (PUT true / DELETE), so retries are safe.
- Sync is **poll-based**: `pull()` GETs the whole space every 4s and on focus/visibility/online, and adopts the remote tree. It skips adopting while there are unflushed local ops or an open dialog.
- Status pill states: `local` (sync off), `syncing`, `synced`, `alone`, `offline`.
  **`synced` reports the phone count** (“Synced · 2 phones”), and `alone` (amber,
  “Synced · 1 phone”) means this phone reached its space but no other phone has
  ever appeared there. This distinction exists because the pill used to say only
  “Synced”, which meant “I reached the space I am configured for” — two phones on
  two *different* spaces both claimed to be synced, which is exactly how the
  reported desync went unnoticed. Do not collapse `alone` back into `synced`.
- **Presence.** Each phone has a stable random `deviceId` (`att.device.v3`, with a
  user-editable friendly name) and writes `devices/<deviceId>` on connect, on
  focus/visibility/online, and at most every 45s while polling. `pull()` already
  GETs the whole space, so reading the other phone's heartbeat costs no extra
  request. Heartbeats are sent **directly, never through the op queue** — they are
  not data, must not be replayed from the queue, and must never fail a flush.
  If `pull()` finds this phone's own heartbeat missing from the space, it
  re-registers immediately rather than waiting out the 45s throttle.
- **Space fingerprint.** `spaceFingerprint(dbUrl, code)` is a 4-character hash of
  the database URL plus space code, shown live in the setup sheet *before* sync is
  turned on and in the sharing sheet afterwards. Two phones on the same space
  always show the same 4 characters. Host capitalisation is normalised (DNS is
  case-insensitive); the **code's capitalisation is not**, because Firebase paths
  are case-sensitive — `Ruhaan-Family` and `ruhaan-family` are two different
  spaces, and that is precisely the mistake the fingerprint is there to expose.
- **`pull()` refuses to adopt a space with no kids in it** when this phone does
  have kids; it re-seeds the space instead. Without this, a space containing only
  a `devices/` node is non-`null` and would blank out a phone full of real data.
  Because Firebase prunes empty nodes, "every kid was deleted" and "this space was
  never set up" both arrive over REST as a missing `meta`, so `meta/seeded` marks
  the difference: an empty-but-seeded space **is** adopted, so deliberate
  deletions still propagate. Every write path goes through `metaForWrite()`, which
  keeps that marker attached.
- **Joining a space that already has data offers a merge**, not just the old
  replace. `mergeTrees(local, shared)` matches kids and classes by id first and
  then by normalised name (trimmed, lower-cased, whitespace-collapsed), so two
  phones that each independently created their own "Ruhaan" / "Phonics" fold into
  one instead of duplicating. Records are a **union** — a day marked on either
  phone stays marked — and the shared space wins on scalar conflicts (name, emoji,
  colour), so both phones end up showing the same avatar. `mergeTrees` never
  mutates its inputs and is a no-op on identical trees.
- There is a **Test connection** button in the sync setup sheet: it does PUT → GET → DELETE on a temp key and reports success/failure. This exists because the original author could not reach Firebase to end-to-end test; keep it.

### localStorage keys
- `att.tree.v3` — canonical data tree
- `att.ui.v3` — `{ activeKidId }` (per-device)
- `att.sync.v3` — `{ dbUrl, code }` (per-device; sensitive; never commit)
- `att.queue.v3` — pending sync ops
- `att.device.v3` — `{ id, name }` for this phone's presence heartbeat (per-device)
- Older keys `attendance.register.v2` / `.v1` are auto-migrated on load; keep the migration.

## Tests

`synccore.test.js` is a Node script (no dependencies) that duplicates the **exact** pure sync-core functions embedded in `index.html` and verifies two-device convergence: concurrent marks on different days, unmarking, add/delete kid & class, PATCH edits preserving nested classes, seeding an empty space, the blank-space guard, delete-all still propagating, space fingerprints, and merge behaviour.

**If you change any of these functions in `index.html` — `deepGet/Set/Merge/Delete`, `applyRest`, `stateToTree`, `treeToState`, any `op*` builder, or `treeHasKids` / `spaceIsSeeded` / `metaForWrite` / `normName` / `mergeTrees` / `spaceFingerprint` — copy the identical change into `synccore.test.js` and run `node synccore.test.js`. All tests must pass (currently 60/60).** Keeping the two copies in sync is the safety net; do not let them drift.

The last test enforces that automatically: it reads `index.html`, extracts the
`PURE SYNC CORE` block from both files, and fails with a line-by-line diff if they
have diverged. It is skipped (not failed) if `index.html` isn't next to it. So the
drift rule above is now checked rather than merely remembered — but you still have
to make the edit in both places.

## Conventions / gotchas

- Vanilla JS only, ES5-friendly style (`var`, function declarations), because it must run anywhere with no tooling.
- All colors come from CSS variables; kid theming swaps `--accent` / `--kidc`. Keep it that way.
- No `localStorage`/`sessionStorage`-breaking assumptions in the render path (already try/catch-wrapped).
- Keep everything in one file. If asked to add features, add them inline and keep the offline + on-device + single-file guarantees intact.

## Troubleshooting: "the two phones aren't syncing"

This has happened for real; work through it in this order.

1. **Compare the Space ID.** On both phones: status pill → Sharing & sync. If the
   two 4-character Space IDs differ, the phones are on **different spaces** and
   neither is wrong about being "Synced" — they are each syncing to their own
   private copy. Usually the space code was typed with different capitalisation or
   a different separator (`-` vs `_`), or one phone has a different database URL.
2. **Check the phone list.** The same sheet lists every phone that has ever
   appeared on the space, with last-seen times, and warns outright when only this
   phone has been there. A pill reading "Synced · 1 phone" means the same thing.
3. **A tell-tale symptom:** the same child showing a *different animal* on each
   phone. Avatars are picked at random on creation and are part of synced data, so
   two phones on one space can never disagree about the animal. If they disagree,
   each phone created its own kid in its own space.
4. **To recover without losing anything:** back up on the phone with the most data
   first. Then set both phones to the identical URL and code (**all lowercase is
   safest** — the code is case-sensitive). The second phone will be offered
   **Merge both**, which unions every marked day and folds same-named kids and
   classes together. If the two phones' data has already diverged, prefer Merge
   over "Use shared copy".
5. **If the pill says Offline,** the database URL is wrong or unreachable, or the
   Realtime Database's test-mode rules have expired (Firebase test mode lapses
   after 30 days and then denies all reads and writes). Use **Test connection** in
   the setup sheet to distinguish the two.

## How to deploy

Upload `index.html`, `README.md`, `synccore.test.js` to a GitHub repo. Optionally enable **Settings → Pages** (Deploy from branch → main → root) to serve the app at `https://<user>.github.io/<repo>/`, which also enables "Add to Home Screen" on phones.

## History of changes (most recent last)

1. Single-kid counter with per-day marking, date-range counts, backup/restore, on-device storage.
2. Multiple kids; colorful per-kid reward-chart theme; stars replaced tally marks.
3. Per-class calendar view over the selected range, with tap-to-mark days.
4. Live two-phone sync via the user's own Firebase Realtime Database (REST + poll + op queue), with local-only fallback and a Test-connection helper.
5. Sync trust & recovery: space fingerprint, phone-presence heartbeats and an
   honest phone-count in the status pill, a guard against a blank space wiping a
   phone, and merge-on-join. Fixes a real-world desync in which two phones sat on
   two different spaces (space codes differing only by capitalisation) while both
   displayed "Synced".
