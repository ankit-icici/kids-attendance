# Context for future sessions

I run a fashion label in Gurugram, India, with about 10 workshop staff.
This repo is a working attendance and payroll app. Read this file and SETUP.md,
then payroll.js, app.js, index.html, firestore.rules. Then wait for my request.

Live app: https://ankit-icici.github.io/sg-attendance/
Repo: https://github.com/ankit-icici/sg-attendance

## What it is

A geofenced attendance and payroll PWA. Staff punch in and out only when within
a set radius of my workshop. I see live attendance and calculate monthly salaries.

## Hard constraints — do not break these

- Must stay free forever. Firebase Spark tier plus GitHub Pages. Never suggest
  anything needing a credit card or a paid plan.
- No App Store or Play Store. It is a PWA installed via "Add to Home Screen".
  I will not pay Apple $99/year.
- No build step. Plain ES modules. No npm, no bundler, no framework. I upload
  files through the GitHub web interface. I do not use a terminal.
- Must work on iOS Safari and Android Chrome.
- Nothing may depend on Anthropic or any AI service at runtime.
- No browser localStorage for data, only the signed-in worker id. Firestore is
  the single source of truth.
- Firebase Storage is unavailable on Spark, so no photo or file uploads.

## Stack

- Firebase project sg-attendance-17c23, Firestore in asia-south1, Anonymous auth
- Firebase JS SDK v11.0.2 from the gstatic CDN
- GitHub Pages, public repo, flat files, no sub-folders
- 14 files, all flat at the repo root:
    index.html        the whole UI: every screen, all CSS, all element ids
    app.js            Firebase wiring, geofence, screens, admin, exports
    payroll.js        the pay engine. PURE functions, no Firebase imports
    config.js         Firebase keys. The only file that is deployment-specific
    sw.js             service worker. Bump CACHE when you change shipped files
    manifest.json     PWA manifest
    logo.svg          full Sonali Garg lockup, fill=currentColor
    logo-mark.svg     the Sg monogram alone, cropped. Used in tight headers
    icon-192.png, icon-512.png, icon-maskable.png   app icons
    firestore.rules   paste into Firebase console → Firestore → Rules → Publish
    SETUP.md          the owner's guide
    CONTEXT.md        this file
  index.html fetches logo.svg into [data-logo] and logo-mark.svg into [data-mark]
  at runtime. If either file is missing the crest and headers render empty.
- payroll.js is pure functions with no Firebase imports so it can be unit tested
  with node. Always test payroll changes that way before giving them to me.

## Where things live

Six screens in index.html, switched by adding class `on` to one `<section>`:
`s-boot`, `s-login`, `s-adminlogin`, `s-setup`, `s-worker`, `s-admin`.

The admin screen has four tabs (`p-today`, `p-people`, `p-pay`, `p-rules`):

  Today     live board with the still-clocked-in escalation and the red
            "forgot to punch out" banner; the full punch feed; and
            "Correct a day" (fixWorker/fixDate/fixLoad → loadFixDay)
  People    roster, add a worker, unlink a phone, remove from roster
  Payroll   month payslips (runPay → renderPayroll) and the
            Daily register date range (runReg → downloadHtmlRegister,
            runRegCsv → downloadCsvRegister)
  Settings  location fence, the working day, the night ladder, closures

Key functions in app.js: `paintFence` (the geofence ring), `paintBoard` (admin
live board, re-painted by a 60-second `boardTick` as well as by snapshots),
`refreshFromServer` (on visibilitychange), `loadFixDay` (corrections),
`downloadHtmlRegister` (the styled register).

All colour lives in `:root` in index.html as CSS variables. app.js only ever
references them by name — never hardcode a hex in app.js.

## Firestore data model

```
config/workshop   brand, lat, lng, radiusM, shiftStart, shiftEnd, standardHours,
                  offDayStandardHours, breakMins, breakAfterHours,
                  nightAfterHours, doubleNightAfterHours, sundayMultiplier,
                  dayBoundary, graceMin, deductLate, adminPinHash

workers/{id}      name, type (monthly|daily), monthlySalary, dayRate,
                  pinHash, deviceUid, active

punches/{id}      workerId, workerName, type (in|out), at (serverTimestamp),
                  lat, lng, accuracy, distanceM, deviceUid, flagged

holidays/{YYYY-MM-DD}   name
```

## The engine, and how to test it

payroll.js has no Firebase imports on purpose, so it runs under plain node.
ALWAYS test a pay change this way before handing files over:

    node --input-type=module -e "
      import('/path/to/payroll.js').then(m => {
        console.log(m.paidHours(15, cfg), m.extraWork(14, cfg, 8));
      });"

What it exports:

    computePayroll({year, month, workers, punches, holidays, cfg})
        the whole month. Returns { rows[], total, workingDays, ... }.
        Each row carries a `detail[]` of one entry per calendar day.
    dailyRegister({months, workers, cfg, from, to})
        flattens several months of detail into register rows
    paidHours(floor, cfg, std)      floor time → paid hours, breaks removed
    extraWork(paid, cfg, std)       → { units, otHours, otAfterNight, label, long }
    applyAdjustments(punches, adjustments)   merges the owner's corrections
    buildDay(punches)               pairs in/out → { hours, firstIn, lastOut, issues }
    workDayKey(date, cfg)           which work day a moment belongs to
    standardFor(kind, cfg, isMonthly)   paid hours that make a full day
    maxShiftFloor(cfg)              longest legitimate shift, for the alert
    monthCalendar, dayKey, hhmm, fmtDuration, money, withDefaults, DEFAULTS

Two checks that must pass after ANY pay change:
  1. Every day's `amount` in `detail` must sum to `gross` minus `basisAdjust`.
  2. Pay must never fall as floor time rises. Scan every minute from 0 to 21 h.
     Break handling has broken this twice; see the note on plateaus below.

## My pay rules — get these exactly right

Everything is priced in DAYS. One day is one normal day's pay: salary / 30 for
salaried staff, the agreed day rate for daily-wage staff.

### Floor time to paid hours

There are two unpaid breaks. Lunch comes out of any day long enough to have taken
one (phased in from `breakAfterHours` = 6). **Dinner comes out only of a night or
longer** — a worker staying late on overtime is not given dinner, so nothing is
deducted from them for it. There is no dinner clock threshold; `paidHours()`
derives it from whether a night is reached, and takes the day's own standard, so a
salaried rest day (7 h) has its night at 13 paid rather than 14.

    8.5 h floor -> 8 paid     lunch only       a full day
   12.0 h floor -> 11.5 paid  lunch only       day + overtime, NO dinner
   15.0 h floor -> 14 paid    lunch + dinner   day + night
   19.0 h floor -> 18 paid    lunch + dinner   day + double night  (8.5+6.5+4)

Dinner is a LUMP taken from `dinnerFrom = std + nightAfterHours + brk` (14.5 h on
a weekday, 13.5 h on a salaried rest day). It has to be a lump, not phased like
lunch, or the night arrives at 14.5 h floor instead of the 15 the owner
specified — he checked this himself and corrected an earlier version that did.

KNOWN AND ACCEPTED: this creates one step DOWN of about Rs57 in the half hour
from 14.5 to 15 h floor. It is the only non-monotonic point in the scheme.
Phasing dinner in, or granting the night at 14.5, removes the dip but breaks the
owner's floor arithmetic — he has rejected both. Do not "fix" it without asking
him. Verified by scanning every minute from 0 to 21 h; there are no others.

### The night ladder

Measured in extra PAID hours beyond that day's standard:

    6 extra paid hours   = a NIGHT,        worth one extra day
    4 more beyond that   = a DOUBLE NIGHT, worth two extra days

So on a weekday: 8 h paid = 1 day, 14 h = 2 days, 18 h = 3 days.
On a salaried rest day (7 h standard): 7 h = 1 day, 13 h = 2, 17 h = 3.

### Overtime — two rates

Extra hours that do NOT complete a night are overtime by the hour:

    before any night is complete   one day / standardHours (8)
    after a night is complete      one day / nightAfterHours (6)

The second is higher because a night is only six hours long. Hours beyond the
DOUBLE night are also paid at one day / 6 — there is no cap on pay. Such a day
sets `longDay` so the owner notices it in the register, but that is NOT an error
and must stay out of `issues`, which is reserved for genuine punch problems that
block payment.

Worked example, Rs25,000 salary, 16 paid hours = day + night + 2 h beyond:
833.33 x 2 + 833.33/6 x 2 = **Rs1,944**.

Nights pay far better than the same hours as overtime, which is the point: six
extra hours as overtime is Rs625, but completing the night is a whole extra day.

### Monthly (salaried) staff

One day = monthlySalary / `payDaysPerMonth`, which is ALWAYS 30 regardless of the
month's length. Absent on a working day deducts one day. Fewer than 8 paid hours
deducts the shortfall pro-rata. Lateness is recorded and shown but NOT deducted
separately — the money already comes off through short hours and nobody may be
charged twice.

**Sundays and declared festival closures are PAID REST DAYS.** They sit inside the
salary and are never deducted. Working one earns a SECOND full day on top, so a
worked Sunday is worth two days. In the engine these are separate values:
`baseShare` is the rest day the salary covers, `extraShare` is the day earned by
working it. Keep them separate or a worked Sunday silently pays once.

A rest day they are called in for is a SHORTER day at the same pay: 7.5 h on the
floor, 7 paid, still one full day. There is no Sunday premium
(`sundayMultiplier` = 1).

### Daily-wage staff

One day = their agreed `dayRate`. They are NOT paid by the hour — a full day
(8.5 h floor, 8 h paid) pays the flat day rate, and a part day is pro-rata. No
absence deduction, because they are called in only when needed.

They work a full 8-hour paid day on EVERY day including Sundays and closures —
`offDayStandardHours` applies to salaried staff only. See `standardFor()`.

They get no rest-day pay, only the worked day. They DO get the same night ladder
and the same two overtime rates, so a night pays two day rates and a double night
three.

The old field name was `hourlyRate`; a legacy record with no `dayRate` is read as
`hourlyRate x standardHours`, which is what a full day used to come to.

## Bugs already found and fixed — do not reintroduce

1. Overnight shifts cross midnight, so a punch-out lands on the next calendar
   date. Punches MUST be bucketed by `workDayKey()` using the 06:00
   `dayBoundary`, never by calendar date. This applies to the live worker screen
   and the admin board too, or the button wrongly flips back to "punch in" at
   midnight.
2. Daily-wage staff working a Sunday must NOT get both hours-times-rate AND the
   off-day day. That double-paid them. Off-day work is excluded from
   `workedDayU`, which is the daily-wage base.
3. Every payslip line item must be rounded BEFORE summing, so the printed
   figures add up exactly to the total. But NEVER round a unit share before
   multiplying it by a rate — extraWork() and the per-day amount must both work
   from exact fractions.
7. computePayroll redistributes sub-rupee rounding across the earning days so the
   daily register sums EXACTLY to the payslip. Do not remove that pass.
8. Each day in the register shows its own TRUE rounded amount so any figure can
   be hand-checked. The remainder — sub-rupee rounding plus the 30-day-basis gap
   in months that are not 30 days — is reported in one visible `basisAdjust`
   line. Do NOT smear it across the days; the owner checks individual figures.
4. `app.js` uses an `on(id, event, fn)` helper wrapping `addEventListener`. When
   editing, check you have not left a duplicate handler. Both will fire and the
   stale one can overwrite good data.
5. Icons are flat at the repo root, not in an `icons/` folder.
6. The roster and settings are re-read on `visibilitychange`, because a phone
   suspends the app rather than restarting it. Without that, a newly added worker
   never appears on a phone that was already open.

## Deliberate design decisions

- The admin Today board escalates an open session: green, then gold past the
  shift, then a red banner past maxShiftFloor() (19 h) naming anyone who has
  almost certainly forgotten to punch out. The board re-paints on a 60-second
  timer as well as on new punches, or a forgotten punch-out would only surface
  when somebody else happened to punch. There is no push notification: sending
  one needs Cloud Functions, which needs the paid Blaze plan.

- Punch times use `serverTimestamp()` so a changed phone clock cannot fake them.
- Attendance is append-only. Rules block all update and delete on punches.
  The owner corrects days by writing to `adjustments`, which applyAdjustments()
  merges at read time, so the original punch always survives and every fix leaves
  a trace. Keep it this way — do not make punches editable.
- Each worker account is locked to one device via `deviceUid` so nobody can punch
  in for a colleague. The owner can unlink a phone.
- The radius is adjustable and every punch logs its measured distance and GPS
  accuracy, because indoor GPS drifts 50 to 100 metres and a hard 50 metre fence
  locks out people standing at their machines.
- Location is read only while the app is open and the button is pressed. There is
  no background tracking, deliberately.
- Accepted limitation: the owner PIN protects the admin screen, not the database.
  Without a server, anonymous auth cannot distinguish owner from staff. This is
  acceptable for 10 people I know personally.

## Backup and restore

Settings tab. `dumpAll()` exports config + workers + punches + archive + holidays
+ adjustments as one JSON file, with all Timestamps as ISO strings so the file
stays readable in any tool years later. Restore parses it, replaces config /
workers / holidays / adjustments by document id, and writes all attendance into
`archive`. Verified by round trip: restored history produces byte-identical pay,
and live + restored together do not double-count.

There is no automatic backup — that would need a server. It is a button the owner
presses, so SETUP.md tells him to do it monthly.

## How I deploy

Give me complete finished files. Never diffs, patches, or "change line 47".
I download them and drag them into the GitHub web uploader. Tell me exactly which
filenames changed and nothing more.

## How to work with me

I am not a programmer. Explain in plain language. Ask me about business rules
rather than guessing, because my pay rules have edge cases you will not predict.
Tell me when you find a bug in existing code rather than quietly fixing it.
