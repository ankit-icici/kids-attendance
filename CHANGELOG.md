# Changelog

All notable changes to this project are recorded here. Newest at the top.

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
