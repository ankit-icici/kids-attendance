# Changelog

All notable changes to this project are recorded here. Newest at the top.

## v8 — Installable, so the data stops disappearing
- **The app is now installable, and that is the whole point.** Chrome only grants
  *persistent* storage — storage it will not delete when the phone runs low on space —
  to apps it considers installed, and it will not offer to install without a web app
  manifest and a service worker with a fetch handler. Added
  `manifest.webmanifest`, `icon-192.png`, `icon-512.png` and `sw.js`. Both phones are
  now installed with "Storage: protected" confirmed.
  **"Add to Home Screen" is not installing and gives no protection whatsoever** — it
  makes a bookmark that shares Chrome's ordinary evictable storage. Acting on that
  misunderstanding is what allowed a second wipe.
- `sw.js` is deliberately **network-first**: the live version always wins when
  reachable, so a deploy can never be silently withheld. Offline capability is a
  side effect, not the purpose. Bump its `CACHE` constant on every release.
- **Sharing being off is no longer silent.** A new `att.eversynced.v3` flag remembers
  that sharing once worked on this phone, so its absence raises a full banner —
  "Sharing is off, this phone is the only copy" — with buttons to reconnect or back
  up. Previously the only signal was a grey pill, and one phone sat as the sole copy
  of everything for nine days without anyone noticing.
- **Turning sharing off now states the consequence** ("this phone becomes the ONLY
  copy") instead of the reassuring "your data stays on this phone".
- **Recovery link.** Sharing & sync can copy a link carrying the database address and
  space code in a URL fragment, to be saved off the phone. Both August wipes took the
  sync settings along with the data, so the app came back empty *and* no longer knew
  where its own cloud copy was; one tap on the link now restores it. Treat a saved
  link like a password.

## v7 — Never destroy what you failed to read
- **Persistent storage is now checked, not just requested.** `navigator.storage.persist()`
  returns whether it was *granted* and that answer was being discarded. Browsers
  usually refuse for an ordinary visited page, so the data had been silently
  evictable — and was evicted. The tools section now reports "Storage: protected" or
  "not protected".
- **A corrupt saved value can no longer destroy the data.** `loadLocal()` wrapped
  every key in one try/catch, so a single unparseable value aborted the whole load —
  including the sync config, which is why this presented as "On this phone" with no
  explanation — and then the save at the end of the load wrote an empty tree over the
  data it had just failed to read. Each key is now parsed in isolation and anything
  unreadable is copied aside to `<key>.corrupt.<ts>`, never overwritten.
- **Destructive sync adoptions ask first.** An empty-but-seeded space used to be
  adopted silently, so one accidental delete — or one wrong space code — could wipe
  every phone within a single 4-second poll with no undo. `pull()` now measures the
  loss via `adoptionLoss()` and holds back anything that would remove a kid or 5+
  marked days, offering "keep this phone's copy" or "accept the removal". A single
  unmarked day still passes silently on purpose: a prompt that fires on ordinary
  edits gets tapped through reflexively.
- **A 14-day undo snapshot** (`att.trash.v3`) is written before any adoption that
  loses data, surfaced as a button in the tools section. Undo merges rather than
  replaces, so anything marked since is kept.
- **Stale phones can be removed in the app.** Nothing ever pruned `devices/`, so every
  wipe or reinstall left a permanent extra entry and the phone count drifted upward —
  quietly destroying the trust signal added in v5. Entries now have a ✕, and any
  unseen for 30 days are folded away.
- **`connect()` no longer reports success when it has created an empty space.** A
  mistyped code used to produce a cheerful "shared space created" and an app that
  believed it was synced to nothing. It now says plainly that nothing was found there.
- **Space-code case collisions are caught.** Codes used on the device are remembered
  (`att.codes.v3`) and a retype differing only in capitalisation is blocked with a
  warning. This cannot be detected server-side: the database rules deliberately forbid
  listing spaces, and weakening them for a convenience is not an acceptable trade.
- Tests: 61 → 78. `adoptionLoss` / `lossNeedsConsent` joined the pure sync core and
  are mirrored in `synccore.test.js`.

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
