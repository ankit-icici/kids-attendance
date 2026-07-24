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
    meta/kids/<kidId> = { name, emoji, color, soft, order, classes: { <classId>: { name, order } } }
    records/<kidId>/<classId>/<YYYY-MM-DD> = true      // absence = key removed
  ```
  `state` is derived from `localTree` via `treeToState()` for rendering; `stateToTree()` goes the other way (used for backup restore / seeding a new space).
- **Every mutation is expressed as one or more REST "ops"** (`opMarkDay`, `opAddKid`, `opEditKid`, `opDeleteKid`, `opAddClass`, `opRenameClass`, `opDeleteClass`). `applyOps()` applies each op to `localTree` locally AND (if sync is on) queues it and flushes it to Firebase. Because each op targets a **specific leaf path** (e.g. one day, one class), concurrent edits from two phones do **not** clobber each other — this is the key correctness property. Do not replace this with whole-document last-write-wins.
- Offline edits are queued in `localStorage` (`att.queue.v3`) and flushed on reconnect; ops are idempotent (PUT true / DELETE), so retries are safe.
- Sync is **poll-based**: `pull()` GETs the whole space every 4s and on focus/visibility/online, and adopts the remote tree. It skips adopting while there are unflushed local ops or an open dialog.
- Status pill states: `local` (sync off), `syncing`, `synced`, `offline`.
- There is a **Test connection** button in the sync setup sheet: it does PUT → GET → DELETE on a temp key and reports success/failure. This exists because the original author could not reach Firebase to end-to-end test; keep it.

### localStorage keys
- `att.tree.v3` — canonical data tree
- `att.ui.v3` — `{ activeKidId }` (per-device)
- `att.sync.v3` — `{ dbUrl, code }` (per-device; sensitive; never commit)
- `att.queue.v3` — pending sync ops
- Older keys `attendance.register.v2` / `.v1` are auto-migrated on load; keep the migration.

## Tests

`synccore.test.js` is a Node script (no dependencies) that duplicates the **exact** pure sync-core functions embedded in `index.html` and verifies two-device convergence: concurrent marks on different days, unmarking, add/delete kid & class, PATCH edits preserving nested classes, and seeding an empty space.

**If you change any of these functions in `index.html` — `deepGet/Set/Merge/Delete`, `applyRest`, `stateToTree`, `treeToState`, or any `op*` builder — copy the identical change into `synccore.test.js` and run `node synccore.test.js`. All tests must pass (currently 22/22).** Keeping the two copies in sync is the safety net; do not let them drift.

## Conventions / gotchas

- Vanilla JS only, ES5-friendly style (`var`, function declarations), because it must run anywhere with no tooling.
- All colors come from CSS variables; kid theming swaps `--accent` / `--kidc`. Keep it that way.
- No `localStorage`/`sessionStorage`-breaking assumptions in the render path (already try/catch-wrapped).
- Keep everything in one file. If asked to add features, add them inline and keep the offline + on-device + single-file guarantees intact.

## How to deploy

Upload `index.html`, `README.md`, `synccore.test.js` to a GitHub repo. Optionally enable **Settings → Pages** (Deploy from branch → main → root) to serve the app at `https://<user>.github.io/<repo>/`, which also enables "Add to Home Screen" on phones.

## History of changes (most recent last)

1. Single-kid counter with per-day marking, date-range counts, backup/restore, on-device storage.
2. Multiple kids; colorful per-kid reward-chart theme; stars replaced tally marks.
3. Per-class calendar view over the selected range, with tap-to-mark days.
4. Live two-phone sync via the user's own Firebase Realtime Database (REST + poll + op queue), with local-only fallback and a Test-connection helper.
