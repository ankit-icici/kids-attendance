I need help modifying an app I built. Read the repo before doing anything — do not
propose or write code until you have.

Repo:  https://github.com/ankit-icici/kids-attendance
Live:  https://ankit-icici.github.io/kids-attendance/

You can clone it directly (git clone https://github.com/ankit-icici/kids-attendance) —
GitHub is reachable from your sandbox. Everything you need is in there.

## Read these first, in this order

1. README.md — in full. What the app is, every design decision and WHY, the data model,
   how sync works, the troubleshooting playbook. Treat it as the source of truth.
   Everything unusual in the code is deliberate and explained there. If something looks
   wrong, check the README before assuming it's a bug.
2. index.html — the whole app. Plain HTML/CSS/vanilla JS, no build step.
3. synccore.test.js — the sync tests. Run `node synccore.test.js` FIRST to get a passing
   baseline (currently 78) so you can tell my pre-existing state from your regressions.
4. CHANGELOG.md — what changed when.

## What the app is

A personal app my wife and I use to track our two kids' class attendance. It syncs live
between our two Android phones through my own free Firebase Realtime Database (Spark
tier, asia-southeast1). Hosted on GitHub Pages. Both phones run it as an INSTALLED app
from the home screen, not as a browser tab. I am not a developer — explain things in
plain language.

## Files in the repo

index.html            the entire app
synccore.test.js      sync tests (run with node)
manifest.webmanifest  makes the app installable
sw.js                 minimal service worker (see rules below)
icon-192.png          app icon
icon-512.png          app icon
README.md, CHANGELOG.md, LICENSE

## Hard rules — do not break these

1. index.html must remain ONE self-contained file that still works when opened directly
   from disk with no network. No build tools, no npm, no frameworks, no bundler, no
   external CDN/font/script/style. The manifest, sw.js and icons are the ONLY companion
   files, they exist solely for installability, and they must not be removed — see the
   incident history for what that cost me.
2. Vanilla, ES5-friendly JS — var, function declarations.
3. Data stays on-device in localStorage, with optional Firebase sync over plain REST
   (fetch) — no Firebase SDK. All storage access stays try/catch-wrapped.
4. NEVER put my Firebase database URL, space code, or a recovery link (#j=...) into the
   code, the repo, or any file you produce. They live only in localStorage / my saved
   link. If you need them to diagnose something, ask me.
5. sw.js must keep a fetch handler — Chrome's installability check depends on it, and
   installability is what earns persistent storage. It must stay NETWORK-FIRST. Never
   make it cache-first: that pins me to a stale version and deploys silently never
   arrive. Bump the CACHE constant in sw.js on every release.
6. All colours come from CSS variables. Kid theming swaps --accent / --accent-soft /
   --kidc. Don't hardcode colours.
7. If you change anything inside the PURE SYNC CORE block in index.html —
   deepGet/Set/Merge/Delete, applyRest, stateToTree, treeToState, any op* builder,
   treeHasKids, spaceIsSeeded, metaForWrite, normName, mergeTrees, spaceFingerprint,
   adoptionLoss, lossNeedsConsent — make the IDENTICAL change in synccore.test.js and run
   node synccore.test.js. All tests must pass. The last test extracts the core block from
   both files and diffs them line by line, so drift is caught — but you still have to
   make the edit twice.
8. If you add a Firebase write path, call bumpRev() or the other phone is never told.
9. Heartbeats (devices/<id>) go direct, never through the op queue.
10. Bump APP_VERSION for any real change. Only bump SCHEMA if the data shape changes.

## Architecture facts worth knowing before touching sync

- Canonical local data is a tree (localTree) mirroring the Firebase JSON shape. state is
  derived via treeToState() for rendering; stateToTree() goes back.
- Every mutation is a REST op on a specific leaf path (one day, one class). That is what
  makes concurrent edits from two phones safe. NEVER replace this with whole-document
  last-write-wins.
- Sync is poll-based: a 4s poll GETs only rev (~13 bytes) and fetches the tree only when
  rev changed, to stay inside the free tier's 10 GB/month. Don't reintroduce
  unconditional full GETs.
- Polling stops while backgrounded; returning forces a full resync.
- Dates are local YYYY-MM-DD strings. NEVER toISOString() — timezone drift.
- activeKidId, recording date, range selection and open calendars are per-device UI
  state and are NOT synced.
- Status pill: local, syncing, synced, alone, denied, badurl, offline. Do NOT collapse
  `alone` into `synced` — two phones on different spaces both claiming "Synced" hid a
  real desync for weeks.
- localStorage keys: att.tree.v3, att.ui.v3, att.sync.v3, att.queue.v3, att.device.v3,
  att.backup.v3, att.trash.v3 (undo snapshot), att.codes.v3 (codes used here),
  att.eversynced.v3 (so sharing going missing can be noticed).

## Things that are deliberate — don't "fix" them

- The database rules deny reads above /spaces/$code, so the app CANNOT list spaces and no
  feature may depend on it. The space code is the capability; weakening the rules for a
  convenience is never an acceptable trade.
- PERM_RULES ship in-app with a copy button because Firebase test-mode rules expire after
  30 days and silently kill sync.
- Wrong-region addresses self-correct: databases outside us-central1 are on
  *.firebasedatabase.app, not *.firebaseio.com, and Firebase returns correctUrl in a 400
  body. failFrom() captures it; the banner offers a one-tap fix.
- 401/403 is reported as `denied` ("Access blocked"), never as `offline`.
- pull() holds back any adoption that would lose a kid or 5+ marked days and asks me
  first, snapshotting to att.trash.v3. A single unmarked day passes silently on purpose —
  a prompt that fires on normal edits gets tapped through reflexively.
- loadLocal() parses every key in isolation and NEVER overwrites a value it failed to
  read. Do not "simplify" this back into one try/catch.
- The Test connection button (PUT → GET → DELETE on a temp key) stays.
- Backup exports {kids:[...]} — readable state shape, not the internal tree.

## Incident history — read this, it shaped the code

- 24 Jul 2026: two spaces were created whose codes differed only by capitalisation, and
  both phones reported "Synced" while syncing to separate spaces. Led to the space
  fingerprint, heartbeats, the honest phone count, and merge-on-join.
- 5 Aug 2026: Chrome cleared localStorage for the origin — data AND sync config together,
  so the pill went grey and the app looked wiped. Firebase was untouched; recovered by
  rejoining. v7 fixes: persist() was fire-and-forget so I was never told storage was
  evictable; loadLocal() wrapped all keys in one try/catch so one corrupt value aborted
  the load and then overwrote the data it failed to read; destructive adoptions applied
  silently with no undo; nothing pruned stale devices/ entries; connect() said "shared
  space created" when a mistyped code had quietly made a new empty space.
- 5 Aug 2026 (same day): I uploaded another project's files over the repo by mistake.
  Recovered from git history. When uploading, upload ONLY the specific files intended —
  "Add files via upload" adds alongside and overwrites by name.
- ~8 Aug 2026: sharing went off on my phone and the app showed nothing but a grey pill.
  It stayed the only copy of everything for nine days. v8 added a loud only-copy banner
  and the att.eversynced.v3 flag.
- 16 Aug 2026: Chrome cleared the storage again — same root cause as 5 Aug, but this time
  with no Firebase copy to heal from. A backup file saved it.
- KEY LESSON: "Add to Home screen" is NOT installing, and gives NO storage protection.
  Chrome only grants persistent storage to an INSTALLED app, which requires a manifest
  AND a service worker with a fetch handler. Advising me to add it to my home screen
  without a manifest is what let the second wipe happen. v8 added the manifest, icons and
  sw.js; both phones are now installed with "Storage: protected" confirmed. Never suggest
  "add to home screen" as a protection measure again — say INSTALL, and have me verify by
  checking that the address bar is gone and the storage line reads protected.

## How I want you to work

- Diagnose before you build. If I report a bug, find the specific line and tell me what
  it does. Don't guess or rewrite broadly.
- Tell me when something can't be done the way I asked, and why, and offer the closest
  thing that can. Don't quietly ship something weaker and describe it as what I asked for.
- Verify, don't assert. Run node synccore.test.js and report the count. For load/save or
  URL-parsing changes, boot the inline script in Node against a stubbed DOM (stub
  document.getElementById returning a permissive element, style.setProperty,
  documentElement, localStorage, location, history, btoa/atob) and test the real code
  path. That is how the v7 loadLocal() bug was proven rather than assumed.
- Keep changes minimal and local. No refactors, renames or reformatting I didn't ask for.
- Comment the non-obvious. Comments explain WHY, and name the failure being defended
  against.
- Deliver updated files as downloads, plus a short plain-language note I can paste into
  CHANGELOG.md, plus any README lines that have gone stale.
- Don't assume a screenshot means what it looks like. On 5 Aug an empty app on my laptop
  was simply a different browser's storage, not data loss. Check which device I'm on.

## Your environment

- Your sandbox reaches GitHub but NOT *.firebasedatabase.app / *.firebaseio.com — blocked
  by the egress allowlist. You cannot read my database directly. Either walk me through
  the Firebase console step by step, or use browser automation if I have it connected.
- My phone's localStorage is unreachable from anywhere but my phone. Don't claim you can
  check it; ask me to read the pill or the storage line instead.
- Spark tier means NO server-side backups. Firebase is not a backup; my backup files are.

## What I want to change this time

[describe your change here]
