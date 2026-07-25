# Changelog

All notable changes to this project are recorded here. Newest at the top.

## v6 — Built to last
- **Non-expiring database rules, surfaced in the app.** Firebase test-mode rules
  expire 30 days after setup and then block everything, which would have killed sync
  silently. The setup guide, the sharing sheet and the new error banner all hand over
  permanent replacement rules with a copy button. The rules also deny reads above
  your own space, so nobody can read the database root or list spaces.
- **"Access blocked" is now its own state.** A rules rejection used to be reported as
  "Offline", which is why this failure mode was so hard to diagnose. It now shows a
  red banner naming the likely cause, with a one-tap fix and retry.
- **Downloads no longer grow without limit.** Polling used to re-download the entire
  database every 4 seconds forever; with a tab left open that crossed the free tier's
  10 GB/month inside a year. The poll now checks a tiny revision marker (~13 bytes)
  and only fetches everything when something actually changed.
- **Polling pauses while the app is in the background**, saving data and battery.
  Reopening the app forces an immediate full resync.
- **Backup age is shown**, with a nudge after 45 days — one cloud copy is not a
  backup. The app also asks the browser to keep its storage, since Safari can evict
  data for sites left unused.
- Data now carries a schema version, and the app version is shown at the bottom of
  the tools section.
- **Wrong database address fixes itself.** Databases outside us-central1 sit on a
  different hostname; getting it wrong used to show a bare "Offline". The app now says
  "Wrong address", shows the correct one (Firebase returns it) and offers a one-tap
  fix. The setup guide no longer implies a single hostname pattern.
- Tests: 60 → 61 unit, plus 60 two-phone integration assertions covering the cheap
  polling path, blocked-rules recovery and region self-correction.

## v5 — Trustworthy sync (fixes a real two-phone desync)
- **Space ID.** A 4-character fingerprint of the database URL + space code, shown
  in the setup screen before sync is turned on and in the sharing sheet after.
  Both phones must show the same 4 characters, which makes a mistyped or
  differently-capitalised space code obvious instead of silent.
- **The status pill no longer overstates things.** It now reports the actual phone
  count ("Synced · 2 phones") and turns amber with "Synced · 1 phone" when no other
  phone has ever joined the space. Previously "Synced" only meant "I reached my own
  space", so two phones on two different spaces both claimed to be synced.
- **Phone list.** Each phone sends a lightweight presence heartbeat and the sharing
  sheet lists every phone on the space with last-seen times, plus a warning when
  this phone is alone. Phones can be given friendly names.
- **Merge when joining.** Joining a space that already has data now offers "Merge
  both" alongside the old replace. Same-named kids and classes fold together
  instead of duplicating, and every marked day from both phones is kept.
- **A blank space can no longer wipe a phone.** If the shared space has no kids but
  this phone does, the space is re-seeded instead of the phone being emptied.
  Deliberately deleting every kid still propagates, via a `meta/seeded` marker.
- The star-burst animation can no longer prevent the screen from refreshing on
  browsers without the Web Animations API.
- Tests: 22 → 60, and the suite now fails if the copy of the sync core in
  `synccore.test.js` has drifted from the one in `index.html`.

## v4 — Live two-phone sync
- Optional live sync between two phones using the owner's own Google Firebase
  Realtime Database (plain REST, no SDK, no build step).
- Per-leaf operations (each day / class as its own node) so two phones editing
  at the same time never overwrite each other; offline edits queue and flush on
  reconnect.
- Status pill (On this phone / Syncing / Synced / Offline), in-app setup guide,
  a "Test connection" helper, and "Copy details to share" for the second phone.
- Local-only mode remains the default; the app still works fully offline.
- Added `synccore.test.js` (22 passing convergence tests for the sync core).
- Added inline app icon and repo files (README, LICENSE, CHANGELOG, .gitignore).

## v3 — Calendar view
- Each class gained an expandable month-by-month calendar covering the selected
  date range, with attended days highlighted in the kid's color and today ringed.
- Tap any day in the calendar to mark or unmark attendance for that exact date.

## v2 — Multiple kids + colorful theme
- Support for multiple children, each with a name, an emoji avatar, and a color.
- Selecting a kid re-themes the whole UI to that kid's color.
- Attendance now shown as a star reward chart (stars replaced tally marks), with
  a small celebration animation when a day is marked.

## v1 — Core counter
- Single child, multiple classes. Mark a class present on any day; the counter
  increases (a day can never be double-counted).
- Date-range counting: This month / Last 30 days / This year / All time / Custom.
- Adjustable recording date for back-filling forgotten days.
- Backup / Restore to a JSON file. All data stored on-device.
