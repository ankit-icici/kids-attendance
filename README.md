# Attendance Star Chart

A kids' class-attendance tracker. A parent marks the days a child attended a class; the app counts attended days over any date range, shows them as a star reward-chart and a tappable calendar, supports multiple kids, and can sync live between two phones.

**If you are an AI assistant or developer reading this to help make changes: read this whole file first, then read `index.html`. This file is the memory of why the app is built the way it is. Everything is intentional; check here before changing anything that looks unusual.**

---

## The one hard rule behind every design decision

The owner needs this app to **outlive any single tool or service**. It must keep working even if the AI that built it disappears. That constraint drove every choice below. Preserve it:

- **It is a single, self-contained `index.html` file.** No build step, no framework, no bundler, no npm. Plain HTML + CSS + vanilla ES5-ish JavaScript in one file. Do not introduce a build pipeline or split it into modules unless the owner explicitly asks. Do not add external script/font/CDN dependencies — it must run offline from a local file.
  - **The only sanctioned companion files are `manifest.webmanifest`, `sw.js`, `icon-192.png` and `icon-512.png`.** They exist solely so Chrome will *install* the app, which is the only way it grants persistent storage. `index.html` still works alone from a local file — those references simply 404 harmlessly. Do not remove them: without them the phone's copy is evictable, and Chrome deleted it twice in August 2026. `sw.js` must keep a fetch handler (installability depends on it) and must stay **network-first**; cache-first would pin the owner to a stale version and deploys would silently never arrive.
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

## Designed to keep running for years (do not undo these)

Three things would otherwise have killed this app on a timer. Each fix is load-bearing.

1. **Firebase "test mode" rules expire after 30 days** and then deny every read and
   write. A space set up in test mode dies silently a month later. The app now ships
   the permanent replacement rules (`PERM_RULES`) inside the setup guide, in the
   sharing sheet, and in the error banner, with a copy button. They have no expiry
   date and deny reads above `/spaces/$code`, so nobody can read the database root
   or enumerate spaces — the space code is the capability.
2. **Downloads were unbounded.** Polling used to GET the *entire* space every 4s,
   and the space grows forever. With a tab left open that crossed the free tier's
   10 GB/month within about a year, at which point reads start failing. Now the 4s
   poll GETs `rev` (~13 bytes) and only fetches the whole tree when `rev` changed;
   `bumpRev()` stamps `rev` after every write path. A full resync also runs at most
   every `FULL_MS` (10 min) purely as a safety net for a `rev` bump that never
   landed, and on focus/visibility/online/connect. Measured: ~13 B per idle poll
   instead of ~5 KB, which keeps monthly traffic flat as records accumulate.
   **If you add a write path, call `bumpRev()` or the other phone won't be told.**
3. **Polling stops entirely while the app is backgrounded** (`stopPolling()` on
   `visibilitychange`), saving quota and battery; returning to the app forces a
   full resync so nothing is missed.

A wrong-region database address is also handled explicitly. Databases outside
us-central1 live on `*.firebasedatabase.app`, not `*.firebaseio.com`; Firebase answers
the wrong host with HTTP 400 and a body containing `correctUrl`. `failFrom()` captures
that, the pill shows `badurl` ("Wrong address"), and the banner offers a one-tap fix
that rewrites the stored address. The setup guide no longer implies every database is
on `firebaseio.com`. Without this the mistake surfaces as a bare "Offline".

Also for longevity: `401/403` is reported as `denied` ("Access blocked") with a
banner naming expired rules as the likely cause — never as `offline`, which is what
made this class of failure so hard to diagnose. `meta/schema` stamps the data shape
so a future version can migrate rather than guess. The app requests
`navigator.storage.persist()` because Safari can evict script-writable storage for
sites left unused. The tools section shows how long ago the last backup was and
nudges after 45 days, because one Firebase space is not a backup. The app version is
printed at the bottom of the tools section so you can tell what a phone is running.

## Sync architecture (read carefully before touching)

- Backend: **the owner's own Google Firebase Realtime Database**, accessed over plain REST with `fetch` (no Firebase SDK, to keep the single-file/offline property). Config (database URL + a shared "space code") is entered by the user in-app and stored in `localStorage` under `att.sync.v3`. **The config is never stored in this repo and must never be committed. Do not paste real Firebase URLs or space codes into any file here.**
- Canonical local data is a **tree** (`localTree`) that mirrors the Firebase JSON shape:
  ```
  spaces/<code>/
    meta/seeded = true                                 // "this space was set up on purpose"
    meta/kids/<kidId> = { name, emoji, color, soft, order, classes: { <classId>: { name, order } } }
    records/<kidId>/<classId>/<YYYY-MM-DD> = true      // absence = key removed
    devices/<deviceId> = { name, ts }                  // presence heartbeat, NOT data
    rev = <server timestamp>                           // change marker, cheap to poll
    meta/schema = <n>                                  // data-shape version
  ```
  `localTree` holds only `meta` and `records`. `rev` and `devices` are bookkeeping
  and is deliberately kept out of the local tree, out of backups, and out of the
  op queue.
  `state` is derived from `localTree` via `treeToState()` for rendering; `stateToTree()` goes the other way (used for backup restore / seeding a new space).
- **Every mutation is expressed as one or more REST "ops"** (`opMarkDay`, `opAddKid`, `opEditKid`, `opDeleteKid`, `opAddClass`, `opRenameClass`, `opDeleteClass`). `applyOps()` applies each op to `localTree` locally AND (if sync is on) queues it and flushes it to Firebase. Because each op targets a **specific leaf path** (e.g. one day, one class), concurrent edits from two phones do **not** clobber each other — this is the key correctness property. Do not replace this with whole-document last-write-wins.
- Offline edits are queued in `localStorage` (`att.queue.v3`) and flushed on reconnect; ops are idempotent (PUT true / DELETE), so retries are safe.
- Sync is **poll-based**: `pull()` GETs the whole space every 4s and on focus/visibility/online, and adopts the remote tree. It skips adopting while there are unflushed local ops or an open dialog.
- Status pill states: `local` (sync off), `syncing`, `synced`, `alone`, `denied`, `badurl`, `offline`.
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

**If you change any of these functions in `index.html` — `deepGet/Set/Merge/Delete`, `applyRest`, `stateToTree`, `treeToState`, any `op*` builder, or `treeHasKids` / `spaceIsSeeded` / `metaForWrite` / `normName` / `mergeTrees` / `spaceFingerprint` / `adoptionLoss` / `lossNeedsConsent` — copy the identical change into `synccore.test.js` and run `node synccore.test.js`. All tests must pass (currently 78/78).** Keeping the two copies in sync is the safety net; do not let them drift.

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
5. **If the pill says "Access blocked" (red),** the database rejected the app —
   nearly always expired test-mode rules. Tap the banner's **Show me how to fix it**
   and publish the rules it gives you. Your on-phone data is unaffected.
6. **If the pill says "Wrong address",** the stored database address is for a
   different region. Tap **Use this address** in the banner; the app already knows the
   right one because Firebase returns it.
7. **If the pill says Offline,** the phone has no connection, or the address is wrong
   in a way Firebase can't diagnose. **Test connection** distinguishes the two.
8. **If reads suddenly fail with no rule change,** check the Firebase console's usage
   tab: the free tier allows 1 GB stored and 10 GB downloaded per month, and
   exceeding either causes rejections until the month rolls over.

## How to deploy

Upload `index.html`, `synccore.test.js`, `manifest.webmanifest`, `sw.js`, `icon-192.png`, `icon-512.png`, `README.md`, `CHANGELOG.md` and `HANDOFF.md` to a GitHub repo. Enable **Settings → Pages** (Deploy from branch → main → root) to serve the app at `https://<user>.github.io/<repo>/`.

**On each phone, INSTALL the app — do not merely "Add to Home Screen".** In Chrome, ⋮ → *Install app* (newer Chrome shows *Install and create shortcut*, then choose **Install**). A home-screen *shortcut* is only a bookmark: it shares Chrome's ordinary evictable storage and gives no protection at all. Confirm a real install two ways: the app opens with **no address bar**, and the storage line at the bottom of the tools section reads **"Storage: protected"**. If it says *not protected*, the install did not take and the data remains deletable.

When uploading, upload **only** the files intended. GitHub's "Add files via upload" adds alongside existing files and overwrites by name — dropping in another project's folder once clobbered `index.html` here (recovered from git history).

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
6. Longevity: non-expiring database rules surfaced in-app, revision-based polling so
   downloads stay inside the free tier as records accumulate, background polling
   paused, blocked-access diagnosis, backup-age reminder, persistent-storage request,
   schema stamp, a visible app version, and self-correcting wrong-region addresses.
7. Data-durability hardening: `persist()` is now *checked* rather than merely
   requested and its answer reported in-app; a corrupt `localStorage` value can no
   longer abort the load or overwrite the data it failed to parse; destructive sync
   adoptions are held for confirmation with a 14-day on-device undo snapshot; stale
   phone entries can be removed in-app; `connect()` no longer reports success when it
   has quietly created a new empty space; space-code case collisions are caught
   against codes previously used on the device.
8. Installability: web app manifest, PNG icons and a minimal network-first service
   worker so Chrome will *install* the app and grant persistent storage — the fix for
   two separate wipes in August 2026. Sharing being off is now announced loudly
   instead of shown as a grey pill (`att.eversynced.v3`), the turn-off confirmation
   states that the phone becomes the only copy, and a saveable recovery link
   (`#j=` fragment) restores lost sync settings in one tap.
