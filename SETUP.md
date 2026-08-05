# Atelier Attendance — setup

Everything below is free. No credit card is needed at any point. Budget about
45 minutes for the first setup, then it runs on its own.

You only ever edit **one file**: `config.js`.

---

## Part 1 · Create the database (15 min)

Firebase is Google's app backend. On the free "Spark" plan it gives you
50,000 reads and 20,000 writes a day. Ten people punching twice a day uses
about 20 writes — roughly 0.1% of what you get free.

1. Go to **console.firebase.google.com** and sign in with your Google account.
2. Click **Create a project**. Name it `atelier-attendance`. Turn Google
   Analytics **off** — you don't need it. Click **Create project**.
3. In the left sidebar open **Build → Firestore Database → Create database**.
   - Choose location **asia-south1 (Mumbai)** — closest to Delhi, so it's fastest.
   - Pick **Start in production mode**. Click Enable.
4. Open **Build → Authentication → Get started**. In the *Sign-in method* tab,
   click **Anonymous**, toggle it **Enable**, and Save.
   *(This is how the app recognises each phone without asking staff for
   emails or passwords.)*
5. Go to the **Rules** tab inside Firestore. Delete everything in the box,
   then paste the entire contents of the `firestore.rules` file from this
   folder. Click **Publish**.
6. Click the **gear icon → Project settings**. Scroll to *Your apps* and click
   the **web icon `</>`**. Give it the nickname `attendance`, click
   **Register app**.
7. You'll see a block of code containing `apiKey`, `authDomain` and so on.
   Copy those values into `config.js`, replacing every `PASTE_...` placeholder.
   Save the file.

> These keys are not secret — every web app exposes them. Your data is
> protected by the rules you published in step 5, not by hiding the keys.

---

## Part 2 · Put it online (10 min)

The app needs to be on an `https://` address, because phones refuse to share
GPS location with an insecure page. GitHub Pages does this for free, forever.

1. Create a free account at **github.com**.
2. Click **+ → New repository**. Name it `attendance`. Set it to **Private**
   if you prefer — Pages works either way on personal accounts. Create it.
3. On the repository page click **Add file → Upload files**. Drag in every
   file from this folder, including the `icons` folder. Click
   **Commit changes**.
4. Go to **Settings → Pages**. Under *Branch* choose **main** and **/ (root)**.
   Click Save.
5. Wait two minutes, then refresh. GitHub shows your address, something like:

   ```
   https://yourname.github.io/attendance/
   ```

   That link is your app. Bookmark it.

**Updating later:** upload the changed file to the same repository and the live
app updates within a minute.

---

## Part 3 · First run (5 min)

Do this standing **inside your workshop** — the app reads the coordinates from
the phone you're holding.

1. Open your app link in **Chrome (Android)** or **Safari (iPhone)**.
2. You'll see *Set up the workroom*. Fill in:
   - Business name
   - **Owner PIN** — write this down. There is no reset link.
   - Tap **Use my current position** and allow location access.
   - Radius: leave it at **100 m** to begin with. See the note below.
   - Shift start and end (10:00 to 18:30 gives 8.5 hours on the floor).
   - **Paid hours = one day: 8**, and **unpaid break: 30 minutes**. So 8.5 hours
     present pays as one full day, which is how you described it.
3. Tap **Save and open admin**.

### About the radius

You asked for 50 m. Start at 100 and tighten it after a week — here's why.

Phone GPS is accurate to 5–20 m outdoors but drifts badly indoors, especially
under a metal roof or between concrete walls. At a hard 50 m limit, a tailor
sitting at their machine can read as 70 m away and be locked out.

Every punch records the measured distance and the GPS accuracy, and you can see
both on the *Today* screen. After a week, look at the numbers your staff
actually produce inside the workshop, then set the radius just above the
highest one. You will still catch anyone punching in from home.

---

## Part 4 · Add your team (10 min)

1. In admin, open the **People** tab.
2. For each person enter their name, choose **Monthly salary** or
   **Daily wage — called as needed**, enter the amount, and set a 4-digit PIN.
3. Write each person's PIN on a slip for them.

### Installing it on their phones

Send each person the app link, then:

**iPhone** — open the link in Safari (not Chrome), tap the **Share** button,
scroll down, tap **Add to Home Screen**, tap Add.

**Android** — open in Chrome, tap the **⋮** menu, tap
**Add to Home screen** or **Install app**.

It now sits on their home screen with its own icon and opens full-screen. No
app store, no download, nothing to update.

### First sign-in on each phone

They pick their name, enter their PIN once, and that phone is remembered. The
account is then **locked to that phone** — nobody can punch in for a colleague
from their own handset. If someone changes phone or loses it, tap
**Unlink phone** next to their name in the People tab.

### One thing to check on iPhones

iOS sometimes hands out an approximate location instead of a precise one, which
breaks the fence. On each iPhone go to
**Settings → Privacy & Security → Location Services → Safari Websites** and
make sure **Precise Location** is on.

---

## Part 5 · Running it day to day

**Today tab** — live. Punches appear on your phone within a second of happening,
with the distance and GPS accuracy for each one.

Each person still clocked in shows how long they have been on the floor, and it
escalates as the day goes on:

| | |
|---|---|
| Green, "On the floor · 6h 10m" | normal |
| Gold, "Still in · 10h 30m" | past the end of the shift — expected on a night, otherwise worth a nudge |
| Red banner, "Forgot to punch out?" | past 19 hours, the longest shift possible — almost certainly a missed punch |

The red banner sits at the top of the tab and names everyone affected, so you see
it the moment you open the app. The times refresh every minute on their own, so
you don't have to wait for someone else to punch. Fix it under **Correct a day** —
left unfixed, that day counts as absent.

**Payroll tab** — pick a month, tap Calculate. You get a payslip per person
showing exactly how the figure was reached, plus a spreadsheet download.

### How the maths works

Everything is priced in **day-units**. One unit is a normal paid day — 8 hours
of paid time, which means 8.5 hours on the floor once the 30-minute unpaid
break comes out.

| Time on the floor | Paid hours | Pays as |
|---|---|---|
| 8.5 h | 8 h | **1 day** |
| 15 h | 14 h | **2 days** — day + night |
| 19 h | 18 h | **3 days** — day + double night |

**Lunch comes out of any full day. Dinner comes out only of a night or longer.**
Someone staying late on overtime is not given a dinner break, so nothing is
deducted from them for it.

So the floor times add up as 8.5 + 6.5 + 4 = 19 hours for a double night, with
one hour of breaks taken out, giving 18 paid. The double-night stretch carries no
break of its own.

| On the floor | Paid | Breaks out | |
|---|---|---|---|
| 8.5 h | 8 h | lunch | a full day |
| 12 h | 11.5 h | lunch only | day + 3.5 h overtime, **no dinner** |
| 15 h | 14 h | lunch + dinner | day + night |
| 19 h | 18 h | lunch + dinner | day + double night |

A night takes its full 6.5 hours of floor time. Dinner starts coming out from
14.5 hours, half an hour before the night is reachable, which is what makes the
night land on a full 15 hours rather than 14.5.

One consequence: in the half hour from 14.5 to 15 hours on the floor, pay steps
down by about ₹57 before the night arrives. Anyone in that window is 30 minutes
from the night, which is worth roughly ₹300 more — so in practice they keep
going. It is the only place in the whole scheme where staying longer can pay less,
and it exists because you asked for the floor arithmetic to add up exactly.

A break is treated as time being spent, not as half an hour docked the moment a
threshold is crossed. While someone is eating, their paid hours simply stop
rising and then continue — so staying longer never pays less.


Lunch is only taken out once someone has been present 6 hours, so a short
half-day isn't docked for a lunch nobody took. That threshold is adjustable under
Settings. Dinner needs no threshold — it applies exactly when a night is reached.

### Sundays

A Sunday is a **shorter day at the same pay**: 7.5 hours on the floor, 7 hours
paid, and it still counts as one full day-unit. There is no premium — someone
called in on Sunday earns exactly what a weekday earns, for an hour less work.

Because the Sunday day is 7 paid hours rather than 8, the night ladder starts
from there too. So on a Sunday, 13 paid hours makes a full night (7 + 6) and
pays two days, rather than the 14 it would take on a weekday. Staying 8 paid
hours on a Sunday earns a small part-night for the extra hour, on the same
pro-rata basis as any weekday.

Both figures are editable under Settings — "Paid hours = one day" for weekdays
and "Sunday paid hrs = one day" for Sundays and closures.

### Between the rungs — plain overtime

Extra hours that don't complete a night are **overtime, paid by the hour** at one
day's pay divided by the standard day. On a ₹950 day rate that's ₹950 ÷ 8 =
₹118.75 an hour.

So someone in at 10:00 and out at 20:30 has done 10 hours paid — a full day plus
2 hours — and earns ₹950 + (₹118.75 × 2) = **₹1,188**.

The nights are milestones that pay much better than the hours alone: six extra
hours as overtime would be ₹712, but completing the night pays a whole extra day,
₹950. Between the two milestones you get the night plus overtime on the
remainder, so 16 paid hours is one day + one night + 2 hours overtime.

| Paid hours | Made up of | On a ₹950 day rate |
|---|---|---|
| 8 h | full day | ₹950 |
| 10 h | day + 2 h overtime | ₹1,188 |
| 13 h | day + 5 h overtime | ₹1,544 |
| 15 h floor / 14 h paid | day + night | ₹1,900 |
| 16 h | day + night + 2 h overtime | ₹2,138 |
| 19 h floor / 18 h paid | day + double night | ₹2,850 |

Beyond the double night there are no further milestones, so those hours are
overtime at the same one-day-÷-6 rate. The day is still marked in the register as
"past the double night" so you notice it, but it is not treated as an error.

**Both monthly and daily-wage staff use the same ladder.** What differs is what a
unit is worth:

| | Monthly staff | Daily-wage staff |
|---|---|---|
| One day is worth | Salary ÷ 30, always | Their agreed day rate |
| A full day is | 8 paid hours; 7 on a rest day | 8 paid hours, **every day including Sundays** |
| Sundays and festival closures | **Paid rest days** — no deduction | Nothing; they weren't called |
| Working a rest day | The rest day **plus** another full day | One full day |
| Absent on a working day | Deduct one day (salary ÷ 30) | Nothing |
| Fewer than 8 paid hours | Deduct the shortfall pro-rata | Paid pro-rata for the part day |
| Extra hours short of a night | Overtime at one day ÷ 8 | Overtime at one day ÷ 8 |
| Extra hours beyond a night | Overtime at one day ÷ 6 | Overtime at one day ÷ 6 |
| Night / double night | Add 1 or 2 whole days | Add 1 or 2 whole days |
| Late arrival | Counted and shown; the money comes off through short hours, so nobody is charged twice | Not applicable |

### Two overtime rates

Extra hours are priced differently depending on whether a night has been completed:

- **Before a night** — one day ÷ 8. On ₹25,000 that is ₹104.17 an hour.
- **After a night** — one day ÷ 6, because a night is six hours long. ₹138.89 an
  hour. This applies to every hour past a completed night, including anything
  beyond the double night.

So 16 paid hours on a ₹25,000 salary is a day, a night, and 2 hours beyond the
night: (₹833.33 × 2) + (₹833.33 ÷ 6 × 2) = **₹1,944**.

### Correcting a day

Today tab → **Correct a day**. Pick a person and a date, and you can add a
missing punch or remove a wrong one. Changing a time is a remove plus an add.

Staff punches are **never overwritten**. Corrections are stored as separate
records, so the original always stays on file and you can see what was changed.
That is what keeps the attendance record worth something. Corrections flow
through to the live board, the payslips and the register automatically.

For a shift that ran past midnight, enter the punch-out time as it happened — any
time before 06:00 is understood as the early hours of the next morning.

### The 30-day basis

A monthly salary is always divided by **30**, whatever the calendar says. So on
₹25,000 one day is ₹833.33 and an overtime hour is ₹104.17, in February and in
July alike.

Sundays and any closure you declare are **paid rest days** — they sit inside the
salary and are never deducted. If someone comes in on one, they keep the rest day
*and* earn another full day for the work, so that Sunday is worth two days.

Because a month can hold 28 or 31 days while the divisor stays at 30, the daily
register can add up to slightly more or less than the salary actually payable.
The register shows that gap as its own **30-day basis adjustment** line rather
than quietly disagreeing with the payslip. In a 30-day month it is zero.

### Night shifts and the work-day boundary

A shift starting at 10:00 and ending at 04:30 the next morning is **one shift**,
not two half days. The app handles this with a work-day boundary set to
**06:00**: anything punched before 6am counts towards the previous day.

Keep the boundary earlier than any shift start and later than any shift end. If
your nights ever run past 6am, move it to 07:00 under Settings.

This also means the worker's own screen and your Today board keep showing the
same shift at 2am — the button correctly says "punch out", not "punch in".

**Settings tab** — adjust the radius, the day and break, the night ladder
thresholds, what a Sunday is worth, and the work-day boundary. As you type,
a live example shows what a long day will actually pay. Add festival closures
**before** running payroll for that month.

### Forgotten punch-outs

If someone forgets to punch out, that day shows 0 hours and counts as absent,
and payroll warns you before you pay. To correct it, open Firestore in the
Firebase console, find the `punches` collection, and add a matching `out`
record. The app deliberately cannot edit attendance history — that's what stops
staff quietly rewriting their own hours.

---

## What this does not do

Worth knowing up front rather than discovering later.

- **GPS can be faked on Android** using mock-location apps. Locking each
  account to one phone and logging accuracy handles the realistic cases, but a
  determined person with a rooted phone could get around it.
- **The owner PIN protects the admin screen, not the database.** Because there
  is no server, a technically skilled employee who dug into the app's code
  could in principle change settings directly. Attendance records themselves
  are locked — they cannot be edited or deleted from the app by anyone.
- **No background tracking.** The app only reads location while someone is
  looking at it and pressing the button. It cannot follow anyone around, which
  is both a privacy feature and a legal safeguard.
- **No photo verification.** Firebase's free tier doesn't include file storage.

For ten people you know personally, this is a reasonable place to land. If you
grow past about 30 staff or start needing tighter controls, that's the point to
revisit it.

---

## Keeping it alive for years

The three things it depends on, and what happens if they change:

| Depends on | Cost | If it ever changes |
|---|---|---|
| Firebase Firestore free tier | ₹0 at your volume | Export your data as JSON from the console and move to Supabase; only `app.js` needs rewiring |
| GitHub Pages | ₹0, unlimited | Move the same files to Cloudflare Pages or Netlify in ten minutes |
| Phone browsers | ₹0 | Standard web APIs — geolocation has worked since 2010 |

Nothing here calls Anthropic, Claude, or any AI service. It's plain HTML and
JavaScript running against your own Google account. It works whether or not any
AI company exists tomorrow.

### Backup and restore

Settings tab → **Backup**. One button downloads everything — settings, roster,
every punch, closures and corrections — as a single file. **Do this monthly, and
keep it somewhere other than the phone**: email it to yourself, or drop it in
Drive. Without it, your entire attendance history lives in one Google account.

To restore, pick the file under **Restore**. You'll see what's in it before
anything happens, and you have to type RESTORE to confirm. Settings, roster and
closures are replaced; attendance history is **added**, never overwritten.

One thing to understand about restored attendance. A punch can only be written
with the server's own clock — that's what stops anyone forging a time. So
historical punches can't go back where they came from. They land in a separate
archive instead, and the app reads both when working out pay. Restoring twice
does no harm: each record keeps its original identity, so nothing is counted
twice. In the correction screen, restored punches are labelled "from a backup"
rather than "from their phone", so you can always tell which is which.

**Two other things worth doing:**

1. **Download the payroll spreadsheet every month.** A human-readable record,
   independent of everything above.
2. **Keep a copy of the app folder** somewhere other than GitHub.

### If something breaks

| Symptom | Cause and fix |
|---|---|
| "Almost there" on opening | `config.js` still has placeholders |
| "Could not connect" | Firestore or Anonymous sign-in not enabled |
| Location never loads | Not on `https://`, or permission denied — check the browser's site settings |
| Punch button stays greyed out | Genuinely outside the radius, or GPS drifting — check the distance shown in the ring |
| "Missing or insufficient permissions" | The rules from `firestore.rules` weren't published |
| "Linked to another phone" | Expected. Tap Unlink phone in the People tab |
