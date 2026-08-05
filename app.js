import { firebaseConfig } from './config.js';
import {
  computePayroll, dailyRegister, applyAdjustments, buildDay, workDayKey, paidHours, extraWork,
  standardFor, maxShiftFloor, withDefaults, hhmm, money, fmtDuration,
} from './payroll.js';

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
  getAuth, signInAnonymously, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc,
  collection, getDocs, onSnapshot, query, where, orderBy,
  serverTimestamp, Timestamp,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

/* ═══════════════ helpers ═══════════════ */
const $ = (id) => document.getElementById(id);
const on = (id, ev, fn) => $(id)?.addEventListener(ev, fn);

let toastTimer;
function toast(msg, kind = '') {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'on ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = kind), 3200);
}

function show(screen) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('on'));
  $(screen).classList.add('on');
  window.scrollTo(0, 0);
}

async function sha(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const hashPin = (pin, salt) => sha(`${String(pin).trim()}:${salt}:sgl-atelier-v1`);

function metresBetween(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const la1 = a.lat * rad, la2 = b.lat * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function bearingTo(a, b) {
  const rad = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * rad) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) -
            Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lng - a.lng) * rad);
  return Math.atan2(y, x);
}
const prettyDate = (d) =>
  d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
const initials = (n) =>
  (n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

// The current work day began at the boundary hour — which may have been
// yesterday, if it's the small hours and someone is still on a night shift.
function startOfWorkDay() {
  const c = withDefaults(cfg || {});
  const [bh, bm] = String(c.dayBoundary).split(':').map(Number);
  const d = new Date();
  const now = d.getHours() * 60 + d.getMinutes();
  if (now < bh * 60 + (bm || 0)) d.setDate(d.getDate() - 1);
  d.setHours(bh, bm || 0, 0, 0);
  return d;
}

const fmtHours = (h) => {
  const m = Math.round(h * 60);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};

/* ═══════════════ state ═══════════════ */
let db, auth, uid = null;
let cfg = null;             // workshop config
let workers = [];           // roster
let me = null;              // signed-in worker
let geo = { pos: null, dist: null, acc: null, ok: false, err: null };
let watchId = null;
let unsubToday = null, unsubWorkers = null;
let lastPayroll = null;

/* ═══════════════ boot ═══════════════ */
(async function boot() {
  if (firebaseConfig.apiKey.startsWith('PASTE')) {
    document.querySelector('#s-boot .wrap').innerHTML =
      `<div class="serif" style="font-size:24px">Almost there</div>
       <p class="note" style="margin-top:10px">Open <b>config.js</b> and paste your Firebase settings.
       SETUP.md has the steps.</p>`;
    return;
  }
  try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    await signInAnonymously(auth);
    await new Promise((res) => onAuthStateChanged(auth, (u) => { if (u) { uid = u.uid; res(); } }));
    await loadConfig();
    await loadWorkers();
    await loadHolidaySet();
    await loadAdjustments();
    route();
  } catch (e) {
    console.error(e);
    document.querySelector('#s-boot .wrap').innerHTML =
      `<div class="serif" style="font-size:24px">Could not connect</div>
       <p class="note" style="margin-top:10px">${e.message}</p>`;
  }
})();

async function loadConfig() {
  const snap = await getDoc(doc(db, 'config', 'workshop'));
  cfg = snap.exists() ? snap.data() : null;
}
async function loadWorkers() {
  const snap = await getDocs(collection(db, 'workers'));
  workers = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((w) => w.active !== false);
  workers.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

// Kept in memory so the worker screen and the live board know whether today
// runs on the normal standard or the shorter off-day one.
let adjustmentCache = [];
async function loadAdjustments() {
  try {
    const snap = await getDocs(collection(db, 'adjustments'));
    adjustmentCache = snap.docs.map((d) => ({ id: d.id, ...d.data(), at: d.data().at?.toDate?.() }));
  } catch { adjustmentCache = []; }
  return adjustmentCache;
}

let holidaySet = new Set();
async function loadHolidaySet() {
  try {
    const snap = await getDocs(collection(db, 'holidays'));
    holidaySet = new Set(snap.docs.map((d) => d.id));
  } catch { holidaySet = new Set(); }
}

/** 'working' | 'sunday' | 'holiday' for the work day currently in progress. */
function todayKind() {
  const d = startOfWorkDay();
  if (d.getDay() === 0) return 'sunday';
  const p = (n) => String(n).padStart(2, '0');
  const key = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return holidaySet.has(key) ? 'holiday' : 'working';
}
const todayStandard = (w) => standardFor(todayKind(), cfg, !w || w.type === 'monthly');

function route() {
  if (!cfg) return show('s-setup');
  $('brandName').textContent = cfg.brand || 'Attendance';
  const savedId = localStorage.getItem('workerId');
  const savedWorker = workers.find((w) => w.id === savedId);
  if (savedWorker) { me = savedWorker; return openWorker(); }
  fillWorkerPicker();
  show('s-login');
}

/* ═══════════════ first-run setup ═══════════════ */
let pendingLoc = null;

on('grabLoc', 'click', () => {
  toast('Reading GPS…');
  navigator.geolocation.getCurrentPosition(
    (p) => {
      pendingLoc = { lat: p.coords.latitude, lng: p.coords.longitude };
      $('locReadout').textContent =
        `${pendingLoc.lat.toFixed(6)}, ${pendingLoc.lng.toFixed(6)}  ·  ±${Math.round(p.coords.accuracy)} m`;
      toast('Location captured', 'good');
    },
    (e) => toast('Location failed: ' + e.message, 'bad'),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
});

on('saveSetup', 'click', async () => {
  const pin = $('setAdminPin').value.trim();
  if (pin.length < 4) return toast('Owner PIN needs at least 4 digits', 'bad');
  if (!pendingLoc) return toast('Capture the workshop location first', 'bad');
  const data = {
    brand: $('setBrand').value.trim() || 'Attendance',
    lat: pendingLoc.lat, lng: pendingLoc.lng,
    radiusM: Number($('setRadius').value) || 100,
    shiftStart: $('setStart').value || '10:00',
    shiftEnd: $('setEnd').value || '18:30',
    standardHours: Number($('setHours').value) || 8,
    breakMins: Number($('setBreak').value) || 0,
    breakAfterHours: 6,
    payDaysPerMonth: 30,
    offDayStandardHours: 7,
    nightAfterHours: 6,
    doubleNightAfterHours: 4,
    sundayMultiplier: 1,
    dayBoundary: '06:00',
    graceMin: Number($('setGrace').value) || 0,
    deductLate: 'yes',
    adminPinHash: await hashPin(pin, 'admin'),
    createdAt: serverTimestamp(),
  };
  await setDoc(doc(db, 'config', 'workshop'), data);
  cfg = data;
  toast('Workroom ready', 'good');
  openAdmin();
});

/* ═══════════════ worker sign-in ═══════════════ */
function fillWorkerPicker() {
  const sel = $('loginWorker');
  sel.innerHTML = '<option value="">Select your name</option>' +
    workers.map((w) => `<option value="${w.id}">${w.name}</option>`).join('');
}

on('doLogin', 'click', async () => {
  const id = $('loginWorker').value;
  const pin = $('loginPin').value.trim();
  if (!id) return toast('Choose your name', 'bad');
  if (pin.length !== 4) return toast('Enter your 4-digit PIN', 'bad');

  const w = workers.find((x) => x.id === id);
  const h = await hashPin(pin, id);
  if (h !== w.pinHash) return toast('Wrong PIN', 'bad');

  if (w.deviceUid && w.deviceUid !== uid) {
    return toast('This name is linked to another phone. Ask the owner to reset it.', 'bad');
  }
  if (!w.deviceUid) {
    await updateDoc(doc(db, 'workers', id), { deviceUid: uid });
    w.deviceUid = uid;
  }
  me = w;
  localStorage.setItem('workerId', id);
  $('loginPin').value = '';
  openWorker();
});

on('wSignOut', 'click', () => {
  localStorage.removeItem('workerId');
  me = null;
  stopGeo();
  fillWorkerPicker();
  show('s-login');
});
on('toAdminLogin', 'click', () => show('s-adminlogin'));
on('backToWorker', 'click', () => { $('adminPin').value = ''; route(); });

on('doAdminLogin', 'click', async () => {
  const pin = $('adminPin').value.trim();
  if (!pin) return;
  const h = await hashPin(pin, 'admin');
  if (h !== cfg.adminPinHash) return toast('Wrong PIN', 'bad');
  $('adminPin').value = '';
  openAdmin();
});

/* ═══════════════ worker screen ═══════════════ */
function openWorker() {
  show('s-worker');
  $('wName').textContent = me.name;
  $('wDate').textContent = prettyDate(new Date());
  startGeo();
  watchMyDay();
}

function startGeo() {
  if (!navigator.geolocation) {
    geo.err = 'This phone cannot report its location.';
    return paintFence();
  }
  stopGeo();
  watchId = navigator.geolocation.watchPosition(
    (p) => {
      const here = { lat: p.coords.latitude, lng: p.coords.longitude };
      geo = {
        pos: here,
        acc: p.coords.accuracy,
        dist: metresBetween({ lat: cfg.lat, lng: cfg.lng }, here),
        bearing: bearingTo({ lat: cfg.lat, lng: cfg.lng }, here),
        ok: true, err: null,
      };
      paintFence();
    },
    (e) => {
      geo.ok = false;
      geo.err = e.code === 1
        ? 'Location permission is off. Turn it on in your phone settings for this app.'
        : 'Cannot read location right now. Step outside for a moment.';
      paintFence();
    },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 }
  );
}
function stopGeo() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

function paintFence() {
  const fence = $('fence'), R = Number(cfg.radiusM) || 100;

  if (!geo.ok) {
    fence.className = 'fence state-wait';
    $('fDist').textContent = '—';
    $('fUnit').textContent = geo.err ? '' : 'metres away';
    $('fVerdict').textContent = geo.err ? 'No signal' : 'Finding you';
    $('punchNote').textContent = geo.err || '';
    $('punchBtn').disabled = true;
    $('punchBtn').textContent = 'Waiting for location…';
    $('punchBtn').className = 'punch';
    return;
  }

  const d = geo.dist, inside = d <= R;
  const scale = 62 / R;                                  // fence ring sits at r=62
  const distPx = Math.min(d * scale, 90);
  const accPx = Math.min(Math.max(geo.acc * scale, 4), 92);
  const cx = 100 + distPx * Math.sin(geo.bearing);
  const cy = 100 - distPx * Math.cos(geo.bearing);

  $('you').setAttribute('cx', cx.toFixed(1));
  $('you').setAttribute('cy', cy.toFixed(1));
  $('halo').setAttribute('cx', cx.toFixed(1));
  $('halo').setAttribute('cy', cy.toFixed(1));
  $('halo').setAttribute('r', accPx.toFixed(1));
  $('halo').setAttribute('fill', inside ? 'var(--green)' : 'var(--negative)');

  fence.className = 'fence ' + (inside ? 'state-in' : 'state-out');
  $('fDist').textContent = Math.round(d);
  $('fUnit').textContent = 'metres away';
  $('fVerdict').textContent = inside ? 'Inside the workshop' : `Too far — ${R} m allowed`;

  const loose = geo.acc > 50;
  $('punchNote').textContent = loose
    ? `GPS is only accurate to ±${Math.round(geo.acc)} m right now.`
    : `Accurate to ±${Math.round(geo.acc)} m`;

  paintPunchButton();
}

let openSession = false;
function paintPunchButton() {
  const b = $('punchBtn');
  if (!geo.ok) return;
  const inside = geo.dist <= (Number(cfg.radiusM) || 100);
  b.disabled = !inside;
  if (!inside) {
    b.textContent = 'Come closer to punch in';
    b.className = 'punch';
  } else if (openSession) {
    b.textContent = 'Punch out — leaving for the day';
    b.className = 'punch leave';
  } else {
    b.textContent = 'Punch in — I have arrived';
    b.className = 'punch arrive';
  }
}

on('punchBtn', 'click', async () => {
  const b = $('punchBtn');
  const R = Number(cfg.radiusM) || 100;
  if (!geo.ok || geo.dist > R) return toast('You are outside the workshop', 'bad');

  b.disabled = true;
  const kind = openSession ? 'out' : 'in';
  try {
    await addDoc(collection(db, 'punches'), {
      workerId: me.id,
      workerName: me.name,
      type: kind,
      at: serverTimestamp(),            // server clock — phone clock cannot fake this
      lat: geo.pos.lat, lng: geo.pos.lng,
      accuracy: Math.round(geo.acc),
      distanceM: Math.round(geo.dist),
      deviceUid: uid,
      flagged: geo.acc > 50,
    });
    toast(kind === 'in' ? 'Punched in. Have a good day.' : 'Punched out. See you tomorrow.', 'good');
  } catch (e) {
    toast('Could not save: ' + e.message, 'bad');
    b.disabled = false;
  }
});

/* live view of my own work day */
function watchMyDay() {
  if (unsubToday) unsubToday();
  const from = startOfWorkDay();
  const q = query(
    collection(db, 'punches'),
    where('at', '>=', Timestamp.fromDate(from)),
    orderBy('at', 'asc')
  );
  unsubToday = onSnapshot(q, (snap) => {
    const mine = snap.docs
      .map((d) => ({ id: d.id, ...d.data(), at: d.data().at?.toDate?.() }))
      .filter((p) => p.at && p.workerId === me.id);

    const raw = buildDay(mine);
    const std = todayStandard(me);
    const paid = paidHours(raw.hours, cfg, std);
    const night = extraWork(paid, cfg, std);
    openSession = mine.length > 0 && mine[mine.length - 1].type === 'in';
    paintPunchButton();

    $('wLog').innerHTML = mine.length
      ? mine.map((p) => `
          <div class="log-item">
            <span class="tick ${p.type}"></span>
            <span class="log-kind">${p.type === 'in' ? 'Arrived' : 'Left'}</span>
            <span class="log-time mono">${hhmm(p.at)}</span>
          </div>`).reverse().join('')
      : `<div class="empty"><span class="serif">Nothing yet today</span>Punch in when you reach the workshop.</div>`;

    const bits = [];
    if (paid > 0) bits.push(`Paid hours: ${fmtHours(paid)}`);
    else if (openSession) bits.push('Currently clocked in');
    if (night.units > 0 || night.otHours > 0) bits.push(nightWord(night));
    $('wHours').innerHTML = bits.join(' · ');
  });
}

const nightWord = (n) =>
  n.label.startsWith('double night') ? 'Double night earned'
  : n.label === 'night' ? 'Full night earned'
  : n.label === 'night and overtime' ? `Full night + ${n.otHours} hrs overtime`
  : `${n.otHours} hrs overtime`;

/* ═══════════════ admin ═══════════════ */
function openAdmin() {
  show('s-admin');
  $('aBrand').textContent = cfg.brand || 'Attendance';
  $('aToday').textContent = prettyDate(new Date());
  const now = new Date();
  $('payMonth').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const p = (n) => String(n).padStart(2, '0');
  $('regFrom').value = `${now.getFullYear()}-${p(now.getMonth() + 1)}-01`;
  $('regTo').value = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  fillSettings();
  watchBoard();
  renderRoster();
  renderHolidays();
  startBoardTick();
  fillFixPicker();
  $('fixDate').value = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

on('aSignOut', 'click', () => { if (unsubToday) unsubToday(); route(); });

document.querySelectorAll('.tabs button').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.remove('on'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('on'));
    b.classList.add('on');
    $('p-' + b.dataset.tab).classList.add('on');
  })
);

/* live board */
function watchBoard() {
  if (unsubToday) unsubToday();
  const q = query(
    collection(db, 'punches'),
    where('at', '>=', Timestamp.fromDate(startOfWorkDay())),
    orderBy('at', 'asc')
  );
  unsubToday = onSnapshot(q, (snap) => {
    lastBoardPaint = () => paintBoard(snap);
    paintBoard(snap);
  });

  function paintBoard(snap) {
    const punches = applyAdjustments(
      snap.docs.map((d) => ({ id: d.id, ...d.data(), at: d.data().at?.toDate?.() }))
        .filter((p) => p.at),
      adjustmentCache);

    let onFloor = 0;
    const stale = [], late = [];
    const board = workers.map((w) => {
      const mine = punches.filter((p) => p.workerId === w.id);
      const raw = buildDay(mine);
      const std = todayStandard(w);
      const paid = paidHours(raw.hours, cfg, std);
      const night = extraWork(paid, cfg, std);
      const isIn = mine.length && mine[mine.length - 1].type === 'in';
      if (isIn) onFloor++;

      let pill = `<span class="pill idle">Not in yet</span>`;
      if (isIn) {
        // Still clocked in. Normal for most of the day, but once they pass the
        // end of the shift it is worth noticing, and once they pass the longest
        // possible shift it is almost certainly a forgotten punch-out.
        const openedAt = [...mine].reverse().find((p) => p.type === 'in')?.at;
        const openFor = openedAt ? (Date.now() - openedAt) / 3600e3 : 0;
        const state = openFor > maxShiftFloor(cfg) ? 'stale'
                    : openFor > Number(withDefaults(cfg).standardHours) + 1 ? 'late' : 'ok';
        if (state === 'stale') { stale.push(w.name); pill = `<span class="pill flag">Forgot to punch out?</span>`; }
        else if (state === 'late') { late.push(w.name); pill = `<span class="pill ot">Still in · ${fmtDuration(openFor)}</span>`; }
        else pill = `<span class="pill in">On the floor · ${fmtDuration(openFor)}</span>`;
      } else if (mine.length) pill = `<span class="pill out">Left ${hhmm(raw.lastOut)}</span>`;

      const badges = [];
      if (night.units > 0 || night.otHours > 0) {
        badges.push(`<span class="pill ot">${
          night.label.startsWith('double night') ? 'Double night'
          : night.units >= 1 ? 'Night'
          : night.otHours + ' hr overtime'}</span>`);
      }
      if (raw.issues.length) badges.push(`<span class="pill flag">${raw.issues[0]}</span>`);

      return `<div class="roster-row">
        <div class="avatar">${initials(w.name)}</div>
        <div class="roster-main">
          <div class="roster-name">${w.name}</div>
          <div class="roster-sub">${raw.firstIn ? 'In ' + hhmm(raw.firstIn) : '—'}${paid ? ' · ' + fmtHours(paid) + ' paid' : ''}</div>
        </div>
        <div style="text-align:right;display:flex;flex-direction:column;gap:4px;align-items:flex-end">${pill}${badges.join('')}</div>
      </div>`;
    }).join('');

    // The alert the owner needs to see the moment they open the app.
    const alertBox = stale.length ? `
      <div class="card" style="background:#f7ece8;border-color:var(--negative);margin-bottom:12px">
        <div style="font-weight:700;color:var(--negative);font-size:14px">
          ${stale.length === 1 ? 'Someone has' : `${stale.length} people have`} not punched out
        </div>
        <div class="note" style="color:var(--negative);margin-top:4px">
          ${stale.join(', ')} — still showing as on the floor beyond the longest possible shift.
          Fix it under Correct a day, or that day will count as absent.
        </div>
      </div>` : late.length ? `
      <div class="card" style="background:var(--wash-gold);border-color:var(--gold-deep);margin-bottom:12px">
        <div class="note" style="color:#6b5220;margin:0">
          <b>Still clocked in past the shift:</b> ${late.join(', ')}.
          Expected if they are working a night — otherwise remind them to punch out.
        </div>
      </div>` : '';

    $('aBoard').innerHTML = alertBox +
      (board || `<div class="empty"><span class="serif">No one on the roster</span>Add your team under People.</div>`);

    $('aCount').textContent = `${onFloor} of ${workers.length} present`;

    $('aFeed').innerHTML = punches.length
      ? [...punches].reverse().map((p) => `
          <div class="log-item">
            <span class="tick ${p.type}"></span>
            <span class="log-kind">${p.workerName}
              <span style="color:var(--green-lt);font-weight:400">${p.type === 'in' ? 'arrived' : 'left'}</span>
            </span>
            <span style="text-align:right">
              <div class="log-time mono">${hhmm(p.at)}</div>
              <div class="log-meta mono">${p.distanceM}m ·±${p.accuracy}m</div>
            </span>
          </div>`).join('')
      : `<div class="empty"><span class="serif">Quiet so far</span>Punches appear here the moment they happen.</div>`;
  }
}

// The board shows how long each open session has run, so it has to refresh on a
// clock as well as on new punches — otherwise a forgotten punch-out only becomes
// visible when somebody else happens to punch.
let boardTick = null;
function startBoardTick() {
  if (boardTick) clearInterval(boardTick);
  boardTick = setInterval(() => {
    if ($('s-admin').classList.contains('on') && $('p-today').classList.contains('on')) {
      lastBoardPaint?.();
    }
  }, 60000);
}
let lastBoardPaint = null;

/* roster */
$('nwType').addEventListener('change', (e) => {
  const monthly = e.target.value === 'monthly';
  $('nwMonthlyWrap').style.display = monthly ? 'block' : 'none';
  $('nwDayWrap').style.display = monthly ? 'none' : 'block';
});

on('addWorker', 'click', async () => {
  const name = $('nwName').value.trim();
  const type = $('nwType').value;
  const pin = $('nwPin').value.trim();
  if (!name) return toast('Enter a name', 'bad');
  if (pin.length !== 4) return toast('PIN must be 4 digits', 'bad');
  const rate = type === 'monthly' ? Number($('nwMonthly').value) : Number($('nwDay').value);
  if (!rate) return toast(type === 'monthly' ? 'Enter the monthly salary' : 'Enter the day rate', 'bad');

  const ref = doc(collection(db, 'workers'));
  await setDoc(ref, {
    name, type, active: true,
    monthlySalary: type === 'monthly' ? rate : 0,
    dayRate: type === 'daily' ? rate : 0,
    pinHash: await hashPin(pin, ref.id),
    deviceUid: null,
    createdAt: serverTimestamp(),
  });
  $('nwName').value = ''; $('nwPin').value = ''; $('nwMonthly').value = ''; $('nwDay').value = '';
  await loadWorkers();
  renderRoster();
  toast(`${name} added`, 'good');
});

function renderRoster() {
  $('aRoster').innerHTML = workers.length ? workers.map((w) => `
    <div class="roster-row">
      <div class="avatar">${initials(w.name)}</div>
      <div class="roster-main">
        <div class="roster-name">${w.name}</div>
        <div class="roster-sub">${w.type === 'monthly'
          ? money(w.monthlySalary) + ' / month'
          : money(w.dayRate || (w.hourlyRate || 0) * (cfg.standardHours || 8)) + ' / day · on call'}
          ${w.deviceUid ? '' : ' · phone not linked'}</div>
      </div>
      <div style="display:flex;gap:6px">
        ${w.deviceUid ? `<button class="btn ghost sm" data-unlink="${w.id}">Unlink phone</button>` : ''}
        <button class="btn ghost sm" data-remove="${w.id}">Remove</button>
      </div>
    </div>`).join('')
    : `<div class="empty"><span class="serif">Roster is empty</span>Add your first team member below.</div>`;

  $('aRoster').querySelectorAll('[data-unlink]').forEach((b) =>
    b.addEventListener('click', async () => {
      await updateDoc(doc(db, 'workers', b.dataset.unlink), { deviceUid: null });
      await loadWorkers(); renderRoster();
      toast('Phone unlinked — they can sign in on a new device', 'good');
    }));
  $('aRoster').querySelectorAll('[data-remove]').forEach((b) =>
    b.addEventListener('click', async () => {
      const w = workers.find((x) => x.id === b.dataset.remove);
      if (!confirm(`Remove ${w.name} from the roster? Their past attendance stays in the records.`)) return;
      await updateDoc(doc(db, 'workers', b.dataset.remove), { active: false });
      await loadWorkers(); renderRoster();
      toast('Removed from roster', 'good');
    }));
}

/* settings */
function fillSettings() {
  const c = withDefaults(cfg);
  $('cfgLoc').textContent = `${cfg.lat.toFixed(6)}, ${cfg.lng.toFixed(6)}`;
  $('cfgRadius').value = cfg.radiusM;
  $('cfgStart').value = c.shiftStart;
  $('cfgEnd').value = cfg.shiftEnd || '18:30';
  $('cfgHours').value = c.standardHours;
  $('cfgBreak').value = c.breakMins;
  $('cfgBreakAfter').value = c.breakAfterHours;
  $('cfgPayDays').value = c.payDaysPerMonth;
  $('cfgGrace').value = c.graceMin;
  $('cfgDeduct').value = c.deductLate === 'no' ? 'no' : 'yes';
  $('cfgNight').value = c.nightAfterHours;
  $('cfgDouble').value = c.doubleNightAfterHours;
  $('cfgSundayHours').value = c.offDayStandardHours;
  $('cfgBoundary').value = c.dayBoundary;
  paintLadder();
}

// A worked example straight from the live settings, so the owner can see
// what a long day will actually pay before saving.
function paintLadder() {
  const draft = {
    standardHours: Number($('cfgHours').value) || 8,
    offDayStandardHours: Number($('cfgSundayHours').value) || 7,
    breakMins: Number($('cfgBreak').value) || 0,
    breakAfterHours: Number($('cfgBreakAfter').value) || 6,
    nightAfterHours: Number($('cfgNight').value) || 6,
    doubleNightAfterHours: Number($('cfgDouble').value) || 4,
  };
  // Walk floor time upward to find the exact floor hours each milestone needs.
  const floorFor = (paid) => {
    for (let f = paid; f <= paid + 3; f = Math.round((f + 1 / 12) * 100) / 100) {
      if (paidHours(f, draft) >= paid) return f;
    }
    return paid;
  };
  const rung = (std, paid) => {
    const units = Math.min(paid, std) / std + extraWork(paid, draft, std).units;
    return `${floorFor(paid).toFixed(1)}h on floor → ${units.toFixed(0)} day${units === 1 ? '' : 's'} pay`;
  };
  const wk = draft.standardHours, off = draft.offDayStandardHours;
  const n1 = draft.nightAfterHours, n2 = draft.doubleNightAfterHours;
  $('cfgLadder').innerHTML = [
    'Weekday: ' + [wk, wk + n1, wk + n1 + n2].map((p) => rung(wk, p)).join(' · '),
    'Sunday: ' + [off, off + n1].map((p) => rung(off, p)).join(' · '),
  ].join('<br>');
}

['cfgHours', 'cfgSundayHours', 'cfgBreak', 'cfgNight', 'cfgDouble', 'cfgBreakAfter']
  .forEach((id) => $(id)?.addEventListener('input', paintLadder));

on('saveCfg', 'click', async () => {
  const patch = {
    radiusM: Number($('cfgRadius').value) || 100,
    shiftStart: $('cfgStart').value,
    shiftEnd: $('cfgEnd').value,
    standardHours: Number($('cfgHours').value) || 8,
    offDayStandardHours: Number($('cfgSundayHours').value) || 7,
    breakMins: Number($('cfgBreak').value) || 0,
    breakAfterHours: Number($('cfgBreakAfter').value) || 6,
    payDaysPerMonth: Number($('cfgPayDays').value) || 30,
    graceMin: Number($('cfgGrace').value) || 0,
    deductLate: $('cfgDeduct').value,
    nightAfterHours: Number($('cfgNight').value) || 6,
    doubleNightAfterHours: Number($('cfgDouble').value) || 4,
    sundayMultiplier: 1,
    dayBoundary: $('cfgBoundary').value || '06:00',
  };
  await updateDoc(doc(db, 'config', 'workshop'), patch);
  Object.assign(cfg, patch);
  toast('Settings saved', 'good');
});

on('reLoc', 'click', () => {
  toast('Reading GPS…');
  navigator.geolocation.getCurrentPosition(
    async (p) => {
      await updateDoc(doc(db, 'config', 'workshop'), {
        lat: p.coords.latitude, lng: p.coords.longitude,
      });
      cfg.lat = p.coords.latitude; cfg.lng = p.coords.longitude;
      fillSettings();
      toast(`Location updated (±${Math.round(p.coords.accuracy)} m)`, 'good');
    },
    (e) => toast('Location failed: ' + e.message, 'bad'),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
});

/* holidays */
on('addHol', 'click', async () => {
  const d = $('holDate').value, n = $('holName').value.trim();
  if (!d) return toast('Pick a date', 'bad');
  await setDoc(doc(db, 'holidays', d), { name: n || 'Closed' });
  $('holDate').value = ''; $('holName').value = '';
  await loadHolidaySet();
  renderHolidays();
  toast('Closure added', 'good');
});

async function renderHolidays() {
  const snap = await getDocs(collection(db, 'holidays'));
  const list = snap.docs.map((d) => ({ date: d.id, ...d.data() }))
    .sort((a, b) => a.date.localeCompare(b.date));
  $('holList').innerHTML = list.length ? list.map((h) => `
    <div class="log-item">
      <span class="log-kind">${h.name}</span>
      <span class="log-time mono">${h.date}</span>
      <button class="btn quiet" data-delhol="${h.date}" style="width:auto;font-size:13px">Remove</button>
    </div>`).join('')
    : `<p class="note" style="margin:8px 0 0">No closures added. Sundays are already treated as weekly off.</p>`;

  $('holList').querySelectorAll('[data-delhol]').forEach((b) =>
    b.addEventListener('click', async () => {
      await deleteDoc(doc(db, 'holidays', b.dataset.delhol));
      await loadHolidaySet();
      renderHolidays();
    }));
}

/* payroll */
on('runPay', 'click', async () => {
  const v = $('payMonth').value;
  if (!v) return toast('Pick a month', 'bad');
  const [year, month] = v.split('-').map(Number);

  $('payOut').innerHTML = `<div class="card"><div class="empty">Adding it up…</div></div>`;

  // Widen the window by the day boundary at both ends, so a night shift that
  // started on the 31st and ended at 4am on the 1st is still counted.
  const c = withDefaults(cfg);
  const [bh, bm] = String(c.dayBoundary).split(':').map(Number);
  const from = Timestamp.fromDate(new Date(year, month - 1, 1, bh, bm || 0));
  const to = Timestamp.fromDate(new Date(year, month, 1, bh, bm || 0));

  const punchesFixed = applyAdjustments(await readPunches(from, to), await loadAdjustments());

  const hSnap = await getDocs(collection(db, 'holidays'));
  const holidays = new Map();
  hSnap.docs.forEach((d) => { if (d.id.startsWith(v)) holidays.set(d.id, d.data().name); });

  const all = (await getDocs(collection(db, 'workers'))).docs
    .map((d) => ({ id: d.id, ...d.data() }));

  lastPayroll = computePayroll({ year, month, workers: all, punches: punchesFixed, holidays, cfg });
  renderPayroll(lastPayroll);
});

function renderPayroll(r) {
  const monthName = new Date(r.year, r.month - 1, 1)
    .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const anyFlag = r.rows.some((x) => x.flagged);
  const rows = r.rows.filter((x) => x.type === 'monthly' || x.present > 0 || x.nightUnits > 0);

  const nightSummary = (x) => {
    const bits = [];
    if (x.doubleNights) bits.push(`${x.doubleNights} double night${x.doubleNights === 1 ? '' : 's'}`);
    if (x.nights) bits.push(`${x.nights} full night${x.nights === 1 ? '' : 's'}`);
    if (x.otHours) bits.push(`${x.otHours} hrs overtime`);
    return bits.join(', ');
  };

  $('payOut').innerHTML = `
    <div class="card">
      <div class="eyebrow">${monthName}</div>
      <p class="note mono" style="margin:6px 0 0">
        ${r.workingDays} working days · ${r.sundays} Sundays off · ${r.closures} closure${r.closures === 1 ? '' : 's'}
      </p>
      <p class="note" style="margin:8px 0 0">One day-unit = ${cfg.standardHours} paid hours.
      A full night adds one unit, a double night adds two.</p>
      ${anyFlag ? `<p class="note" style="color:var(--negative);margin:10px 0 0">
        Some days need checking — missing punch-outs or unusually long shifts.
        Sort those out before you pay.</p>` : ''}
    </div>

    ${rows.map((x) => `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px">
          <div>
            <div class="serif" style="font-size:20px">${x.name}</div>
            <div class="note">${x.type === 'monthly'
              ? `${money(x.monthlySalary)}/month · one day ${money(x.unitValue)} · OT ${money(x.otRate)}/hr, ${money(x.otRateNight)} after a night`
              : `Daily wage ${money(x.unitValue)}/day · OT ${money(x.otRate)}/hr, ${money(x.otRateNight)} after a night`}</div>
          </div>
          <div style="text-align:right">
            <div class="mono" style="font-size:23px;font-weight:500">${money(x.gross)}</div>
            ${x.flagged ? `<span class="pill flag">${x.flagged} day${x.flagged === 1 ? '' : 's'} to check</span>` : ''}
          </div>
        </div>
        <div class="hr" style="margin:14px 0"></div>
        <table>
          <tbody>
            <tr><td>${x.type === 'monthly' ? 'Agreed salary' : `Days worked (${x.present})`}</td>
                <td class="num mono">${money(x.base)}</td></tr>
            ${x.absentCut ? `<tr><td>Absent ${x.absent} day${x.absent === 1 ? '' : 's'}</td>
                <td class="num mono" style="color:var(--negative)">−${money(x.absentCut)}</td></tr>` : ''}
            ${x.shortCut ? `<tr><td>Short by ${x.shortHours} hrs</td>
                <td class="num mono" style="color:var(--negative)">−${money(x.shortCut)}</td></tr>` : ''}
            ${x.nightPay ? `<tr><td>Night work
                <span class="pill ot">${x.nightUnits} full day${x.nightUnits === 1 ? '' : 's'}</span></td>
                <td class="num mono" style="color:var(--green)">+${money(x.nightPay)}</td></tr>` : ''}
            ${x.otPay ? `<tr><td>Overtime ${x.otHours} hrs${x.otNightHours ? ` (${x.otNightHours} after a night)` : ''}</td>
                <td class="num mono" style="color:var(--green)">+${money(x.otPay)}</td></tr>` : ''}
            ${x.extraDayPay ? `<tr><td>Sundays and closures worked
                <span class="pill ot">${x.extraDayUnits} unit${x.extraDayUnits === 1 ? '' : 's'}</span></td>
                <td class="num mono" style="color:var(--green)">+${money(x.extraDayPay)}</td></tr>` : ''}
            <tr class="total"><td>To pay</td><td class="num mono">${money(x.gross)}</td></tr>
          </tbody>
        </table>
        <div class="note" style="margin-top:10px">
          Present ${x.present}${x.type === 'monthly' ? ` of ${x.workingDays}` : ' days'}
          ${x.extraHours ? ` · ${x.extraHours} extra hrs` : ''}
          ${nightSummary(x) ? ` · ${nightSummary(x)}` : ''}
          ${x.lateDays ? ` · late ${x.lateDays}×` : ''}
        </div>
      </div>`).join('')}

    <div class="card" style="background:var(--green);border-color:var(--gold)">
      <div style="display:flex;justify-content:space-between;align-items:baseline;color:var(--white)">
        <span class="serif" style="font-size:21px">Total payout</span>
        <span class="mono serif" style="font-size:26px;color:var(--gold-soft)">${money(r.total)}</span>
      </div>
    </div>
    <button class="btn ghost" id="dlCsv" style="margin-top:12px">Download as spreadsheet</button>
    <div style="height:30px"></div>`;

  on('dlCsv', 'click', () => downloadCsv(r, monthName));
}

function downloadCsv(r, monthName) {
  const head = ['Name', 'Pay type', 'Present days', 'Absent days', 'Day hours',
    'Extra hours', 'Short hours', 'Full nights', 'Double nights', 'Overtime hours',
    'Night days', 'Sunday units', 'Late days', 'One day', 'Overtime rate', 'Base',
    'Absent deduction', 'Short deduction', 'Night pay', 'Overtime pay',
    'Sunday pay', 'To pay'];
  const lines = [head.join(',')];
  for (const x of r.rows) {
    lines.push([`"${x.name}"`, x.type, x.present, x.absent, x.dayHours,
      x.extraHours, x.shortHours, x.nights, x.doubleNights, x.otHours,
      x.nightUnits, x.extraDayUnits, x.lateDays, x.unitValue, x.otRate, x.base,
      x.absentCut, x.shortCut, x.nightPay, x.otPay, x.extraDayPay, x.gross].join(','));
  }
  lines.push(['TOTAL', ...Array(20).fill(''), r.total].join(','));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `salary-${monthName.replace(' ', '-')}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ═══════════════ refresh on resume ═══════════════ */
// A phone suspends this app rather than closing it, so coming back to it does
// not re-run the boot sequence. Without this, a worker added on the owner's
// phone would not appear in a dropdown that was already on screen — and a
// changed fence radius would not reach a phone that never restarted.
let refreshing = false;
async function refreshFromServer() {
  if (!db || refreshing) return;
  refreshing = true;
  try {
    await loadConfig();
    await loadWorkers();
    await loadHolidaySet();
    await loadAdjustments();

    if (me) {
      const fresh = workers.find((w) => w.id === me.id);
      if (!fresh) {
        // Taken off the roster while the app was in the background.
        localStorage.removeItem('workerId');
        me = null;
        stopGeo();
        fillWorkerPicker();
        show('s-login');
        toast('Your account was removed. Speak to the owner.', 'bad');
        return;
      }
      me = fresh;
      $('wName').textContent = me.name;
      $('wDate').textContent = prettyDate(new Date());
      if (geo.ok) paintFence();
    } else if ($('s-login').classList.contains('on')) {
      const keep = $('loginWorker').value;
      fillWorkerPicker();
      if (workers.some((w) => w.id === keep)) $('loginWorker').value = keep;
    }

    if ($('s-admin').classList.contains('on')) {
      renderRoster();
      fillSettings();
    }
  } catch (e) {
    console.warn('refresh failed', e);
  } finally {
    refreshing = false;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshFromServer();
});
window.addEventListener('online', refreshFromServer);

/**
 * Every punch in a window, live and restored together.
 * Restored history sits in `archive` because it cannot be written back into
 * `punches` — see the Firestore rules. Anything that reads attendance for pay
 * must read both, or a restore would silently lose the history it recovered.
 */
async function readPunches(fromTs, toTs) {
  const grab = async (name) => {
    const snap = await getDocs(query(
      collection(db, name),
      where('at', '>=', fromTs), where('at', '<', toTs), orderBy('at', 'asc')
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data(), at: d.data().at?.toDate?.() }));
  };
  let restored = [];
  try { restored = await grab('archive'); } catch { /* collection may not exist yet */ }
  return [...(await grab('punches')), ...restored]
    .filter((p) => p.at)
    .sort((x, y) => x.at - y.at);
}

/* ═══════════════ backup and restore ═══════════════ */

const BACKUP_VERSION = 1;
const COLLECTIONS = ['workers', 'punches', 'archive', 'holidays', 'adjustments'];

async function dumpAll() {
  const out = {};
  for (const name of COLLECTIONS) {
    const snap = await getDocs(collection(db, name));
    out[name] = snap.docs.map((d) => {
      const raw = { id: d.id, ...d.data() };
      // Timestamps go out as plain ISO text so the file stays readable and
      // portable — it should still make sense years from now, in any tool.
      for (const k of Object.keys(raw)) {
        if (raw[k]?.toDate) raw[k] = raw[k].toDate().toISOString();
      }
      return raw;
    });
  }
  const cfgSnap = await getDoc(doc(db, 'config', 'workshop'));
  const conf = cfgSnap.exists() ? { ...cfgSnap.data() } : {};
  for (const k of Object.keys(conf)) {
    if (conf[k]?.toDate) conf[k] = conf[k].toDate().toISOString();
  }
  return { config: conf, ...out };
}

on('doBackup', 'click', async () => {
  $('backupNote').textContent = 'Gathering everything…';
  try {
    const data = await dumpAll();
    const counts = Object.fromEntries(COLLECTIONS.map((c) => [c, data[c].length]));
    const file = {
      app: 'sg-attendance', version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      brand: cfg.brand || '', counts, ...data,
    };
    const stamp = new Date().toISOString().slice(0, 10);
    saveFile(JSON.stringify(file, null, 2), `sg-attendance-backup-${stamp}.json`, 'application/json');
    $('backupNote').innerHTML = `Saved. ${counts.punches} punches, ${counts.workers} people, ` +
      `${counts.holidays} closures, ${counts.adjustments} corrections` +
      (counts.archive ? `, ${counts.archive} restored records` : '') +
      `.<br>Keep it off this phone — email it to yourself or put it in Drive.`;
  } catch (e) {
    console.error(e);
    $('backupNote').textContent = 'Backup failed: ' + e.message;
  }
});

$('restoreFile')?.addEventListener('change', async (ev) => {
  const f = ev.target.files?.[0];
  if (!f) return;
  let data;
  try {
    data = JSON.parse(await f.text());
  } catch {
    $('restorePreview').innerHTML = `<p class="note" style="color:var(--negative)">That is not a readable backup file.</p>`;
    return;
  }
  if (data.app !== 'sg-attendance') {
    $('restorePreview').innerHTML = `<p class="note" style="color:var(--negative)">That file was not made by this app.</p>`;
    return;
  }

  const c = data.counts || {};
  $('restorePreview').innerHTML = `
    <div class="card" style="background:var(--wash-gold);border-color:var(--gold-deep)">
      <div class="note mono" style="margin:0 0 10px;color:#6b5220">
        From ${new Date(data.exportedAt).toLocaleString('en-IN')}<br>
        ${data.brand || ''}<br><br>
        ${c.workers || 0} people · ${c.punches || 0} punches · ${c.holidays || 0} closures
        · ${c.adjustments || 0} corrections
      </div>
      <p class="note" style="margin:0 0 12px;color:#6b5220">
        Settings, roster and closures will be <b>replaced</b>. Attendance history will be
        <b>added</b> as restored records — nothing already in the app is deleted.
      </p>
      <label class="field"><span>Type RESTORE to confirm</span><input id="restoreWord" placeholder="RESTORE"></label>
      <button class="btn danger" id="doRestore" style="background:var(--negative)">Restore this backup</button>
      <p class="note" id="restoreNote" style="margin:12px 0 0;color:#6b5220"></p>
    </div>`;

  on('doRestore', 'click', async () => {
    if ($('restoreWord').value.trim().toUpperCase() !== 'RESTORE') {
      return toast('Type RESTORE to confirm', 'bad');
    }
    const note = $('restoreNote');
    try {
      note.textContent = 'Restoring settings…';
      if (data.config && Object.keys(data.config).length) {
        const conf = { ...data.config };
        delete conf.createdAt;
        await setDoc(doc(db, 'config', 'workshop'), conf, { merge: true });
      }

      note.textContent = 'Restoring the roster…';
      for (const w of data.workers || []) {
        const { id, createdAt, ...rest } = w;
        await setDoc(doc(db, 'workers', id), rest, { merge: true });
      }

      note.textContent = 'Restoring closures…';
      for (const h of data.holidays || []) {
        const { id, ...rest } = h;
        await setDoc(doc(db, 'holidays', id), rest, { merge: true });
      }

      note.textContent = 'Restoring corrections…';
      for (const a of data.adjustments || []) {
        const { id, at, createdAt, ...rest } = a;
        await setDoc(doc(db, 'adjustments', id), {
          ...rest, ...(at ? { at: Timestamp.fromDate(new Date(at)) } : {}),
        }, { merge: true });
      }

      // Attendance history cannot go back into `punches` — that collection only
      // accepts the server's own clock. It lands in `archive`, marked, and the
      // app reads both when working out pay.
      const history = [...(data.punches || []), ...(data.archive || [])];
      let done = 0;
      for (const p of history) {
        const { id, at, ...rest } = p;
        if (!at) continue;
        await setDoc(doc(db, 'archive', id), {
          ...rest, at: Timestamp.fromDate(new Date(at)), restored: true,
          restoredAt: serverTimestamp(),
        }, { merge: true });
        if (++done % 25 === 0) note.textContent = `Restoring attendance… ${done} of ${history.length}`;
      }

      await loadConfig(); await loadWorkers(); await loadHolidaySet(); await loadAdjustments();
      note.innerHTML = `<b>Done.</b> ${done} attendance records restored. Reopen the app to see everything.`;
      toast('Restore complete', 'good');
      fillSettings(); renderRoster(); renderHolidays(); fillFixPicker();
    } catch (e) {
      console.error(e);
      note.textContent = 'Restore failed: ' + e.message;
    }
  });
});

/* ═══════════════ correct a day ═══════════════ */

function fillFixPicker() {
  const sel = $('fixWorker');
  const keep = sel.value;
  sel.innerHTML = '<option value="">Select a name</option>' +
    workers.map((w) => `<option value="${w.id}">${w.name}</option>`).join('');
  if (workers.some((w) => w.id === keep)) sel.value = keep;
}

/** Loads one worker's work day, showing punches and corrections side by side. */
async function loadFixDay() {
  const wid = $('fixWorker').value, key = $('fixDate').value;
  if (!wid || !key) { toast('Choose a name and a day', 'bad'); return; }

  const c = withDefaults(cfg);
  const [bh, bm] = String(c.dayBoundary).split(':').map(Number);
  const [y, m, d] = key.split('-').map(Number);
  const from = new Date(y, m - 1, d, bh, bm || 0);
  const to = new Date(y, m - 1, d + 1, bh, bm || 0);

  $('fixOut').innerHTML = '<div class="empty">Loading…</div>';

  const raw = (await readPunches(Timestamp.fromDate(from), Timestamp.fromDate(to)))
    .filter((p) => p.workerId === wid);

  const aSnap = await getDocs(collection(db, 'adjustments'));
  const adj = aSnap.docs.map((x) => ({ id: x.id, ...x.data(), at: x.data().at?.toDate?.() }))
    .filter((a) => a.workerId === wid && a.date === key);

  const voided = new Set(adj.filter((a) => a.action === 'void').map((a) => a.punchId));
  const effective = applyAdjustments(raw, adj);
  const w = workers.find((x) => x.id === wid);
  const day = buildDay(effective);
  const paid = paidHours(day.hours, cfg);

  const lines = [];
  for (const p of raw) {
    const dead = voided.has(p.id);
    lines.push(`<div class="log-item"${dead ? ' style="opacity:.45"' : ''}>
      <span class="tick ${p.type}"></span>
      <span class="log-kind">${p.type === 'in' ? 'Arrived' : 'Left'}
        <span class="log-meta">${dead ? '· removed' : '· from their phone'}</span></span>
      <span class="log-time mono">${hhmm(p.at)}</span>
      ${dead ? '' : `<button class="btn quiet" data-void="${p.id}" style="width:auto;font-size:12px;color:var(--negative)">Remove</button>`}
    </div>`);
  }
  for (const a of adj.filter((x) => x.action === 'add')) {
    lines.push(`<div class="log-item">
      <span class="tick ${a.type}"></span>
      <span class="log-kind">${a.type === 'in' ? 'Arrived' : 'Left'}
        <span class="log-meta">· added by you</span></span>
      <span class="log-time mono">${hhmm(a.at)}</span>
      <button class="btn quiet" data-delatr="${a.id}" style="width:auto;font-size:12px;color:var(--negative)">Undo</button>
    </div>`);
  }

  $('fixOut').innerHTML = `
    <div class="note mono" style="margin-bottom:8px">
      ${w ? w.name : ''} · ${prettyKey ? '' : ''}${key}
      · on the floor ${fmtDuration(day.hours)} · paid ${fmtDuration(paid)}
      ${day.issues.length ? `<br><span style="color:var(--negative)">${day.issues.join('; ')}</span>` : ''}
    </div>
    ${lines.join('') || '<div class="empty">No punches on this day.</div>'}
    <div class="hr" style="margin:14px 0"></div>
    <div class="eyebrow" style="margin-bottom:10px">Add a punch</div>
    <div class="row">
      <label class="field"><span>Arrived or left</span>
        <select id="fixType"><option value="in">Arrived</option><option value="out">Left</option></select>
      </label>
      <label class="field"><span>Time</span><input id="fixTime" type="time"></label>
    </div>
    <p class="note" style="margin:-6px 0 12px">For a shift that ran past midnight, a time before
      ${c.dayBoundary} counts as the early hours of the next morning.</p>
    <button class="btn" id="fixAdd">Add this punch</button>`;

  $('fixOut').querySelectorAll('[data-void]').forEach((b) =>
    b.addEventListener('click', async () => {
      await addDoc(collection(db, 'adjustments'), {
        action: 'void', punchId: b.dataset.void, workerId: wid, date: key,
        createdAt: serverTimestamp(),
      });
      toast('Punch removed', 'good');
      loadFixDay();
    }));
  $('fixOut').querySelectorAll('[data-delatr]').forEach((b) =>
    b.addEventListener('click', async () => {
      await deleteDoc(doc(db, 'adjustments', b.dataset.delatr));
      toast('Undone', 'good');
      loadFixDay();
    }));

  on('fixAdd', 'click', async () => {
    const t = $('fixTime').value;
    if (!t) return toast('Enter a time', 'bad');
    const [hh, mi] = t.split(':').map(Number);
    // A time before the boundary belongs to the following morning.
    const isEarly = hh * 60 + mi < bh * 60 + (bm || 0);
    const when = new Date(y, m - 1, d + (isEarly ? 1 : 0), hh, mi, 0, 0);
    await addDoc(collection(db, 'adjustments'), {
      action: 'add', workerId: wid, workerName: w ? w.name : '',
      type: $('fixType').value, at: Timestamp.fromDate(when), date: key,
      createdAt: serverTimestamp(),
    });
    toast('Punch added', 'good');
    loadFixDay();
  });
}

on('fixLoad', 'click', () => loadFixDay().catch((e) => {
  console.error(e);
  $('fixOut').innerHTML = `<div class="empty">${e.message}</div>`;
}));

/* ═══════════════ daily register ═══════════════ */

// Colour key for the register. Kept here so the report and its legend agree.
const CAT = {
  doubleNight: { label: 'Double night', bg: '#dbc078', bd: '#b98947', fg: '#243534', bold: 1 },
  night:       { label: 'Night',        bg: '#ecdcb4', bd: '#b98947', fg: '#243534', bold: 1 },
  overtime:    { label: 'Overtime',     bg: '#fbf5e6', bd: '#e0cfa4', fg: '#243534' },
  offWorked:   { label: 'Rest day worked', bg: '#e4ece9', bd: '#4c7370', fg: '#243534', bold: 1 },
  paidRest:    { label: 'Paid rest day',   bg: '#f2f6f4', bd: '#a8c0b8', fg: '#4c7370' },
  short:       { label: 'Short hours',  bg: '#f7f0ec', bd: '#d3b3a6', fg: '#5a3226' },
  partDay:     { label: 'Part day',     bg: '#f7f0ec', bd: '#d3b3a6', fg: '#5a3226' },
  absent:      { label: 'Absent',       bg: '#f7ece8', bd: '#a6503a', fg: '#a6503a' },
  notCalled:   { label: 'Not called',   bg: '#fbfaf7', bd: '#eeeae0', fg: '#8a9694' },
  off:         { label: 'Not called',   bg: '#fbfaf7', bd: '#eeeae0', fg: '#8a9694' },
  normal:      { label: 'Normal day',   bg: '#ffffff', bd: '#eeeae0', fg: '#243534' },
};

/** Every month touched by a from..to range. */
function monthsInRange(from, to) {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  const out = [];
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    out.push({ year: y, month: m });
    m++; if (m > 12) { m = 1; y++; }
    if (out.length > 36) break;
  }
  return out;
}

async function gatherRange(from, to) {
  const c = withDefaults(cfg);
  const [bh, bm] = String(c.dayBoundary).split(':').map(Number);
  const months = monthsInRange(from, to);

  // One query spanning every month touched, widened by the day boundary so a
  // night shift that ends after midnight still comes back with its own day.
  const first = months[0], last = months[months.length - 1];
  const lo = Timestamp.fromDate(new Date(first.year, first.month - 1, 1, bh, bm || 0));
  const hi = Timestamp.fromDate(new Date(last.year, last.month, 1, bh, bm || 0));

  const punches = applyAdjustments(await readPunches(lo, hi), await loadAdjustments());

  const hSnap = await getDocs(collection(db, 'holidays'));
  const allHol = new Map(hSnap.docs.map((d) => [d.id, d.data().name]));

  const workersAll = (await getDocs(collection(db, 'workers'))).docs
    .map((d) => ({ id: d.id, ...d.data() }));

  const packed = months.map((m) => {
    const tag = `${m.year}-${String(m.month).padStart(2, '0')}`;
    const hol = new Map();
    allHol.forEach((v, k) => { if (k.startsWith(tag)) hol.set(k, v); });
    return { ...m, punches, holidays: hol };
  });

  // Is the range exactly one whole calendar month? Only then can a monthly
  // 30-day-basis adjustment be shown against it meaningfully.
  const endOfLast = new Date(last.year, last.month, 0);
  const p2 = (n) => String(n).padStart(2, '0');
  const wholeMonth = months.length === 1
    && from.endsWith('-01')
    && to === `${endOfLast.getFullYear()}-${p2(endOfLast.getMonth() + 1)}-${p2(endOfLast.getDate())}`;

  return {
    rows: dailyRegister({ months: packed, workers: workersAll, cfg, from, to }),
    months, wholeMonth,
  };
}

function readRange() {
  const from = $('regFrom').value, to = $('regTo').value;
  if (!from || !to) { toast('Pick both dates', 'bad'); return null; }
  if (from > to) { toast('The From date is after the To date', 'bad'); return null; }
  return { from, to };
}

const prettyKey = (k) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN',
    { weekday: 'short', day: '2-digit', month: 'short' });
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

on('runReg', 'click', async () => {
  const r = readRange(); if (!r) return;
  $('regNote').textContent = 'Building the register…';
  try {
    const { rows, wholeMonth } = await gatherRange(r.from, r.to);
    if (!rows.length) { $('regNote').textContent = 'No days in that range.'; return; }
    downloadHtmlRegister(rows, r.from, r.to, wholeMonth);
    $('regNote').textContent = `${rows.length} rows downloaded. Open it in any browser — print to PDF from there.`;
  } catch (e) {
    console.error(e);
    $('regNote').textContent = 'Could not build it: ' + e.message;
  }
});

on('runRegCsv', 'click', async () => {
  const r = readRange(); if (!r) return;
  $('regNote').textContent = 'Building the spreadsheet…';
  try {
    const { rows } = await gatherRange(r.from, r.to);
    if (!rows.length) { $('regNote').textContent = 'No days in that range.'; return; }
    downloadCsvRegister(rows, r.from, r.to);
    $('regNote').textContent = `${rows.length} rows downloaded. The Category column replaces the colours.`;
  } catch (e) {
    console.error(e);
    $('regNote').textContent = 'Could not build it: ' + e.message;
  }
});

function downloadHtmlRegister(rows, from, to, wholeMonth) {
  const byWorker = new Map();
  rows.forEach((x) => {
    if (!byWorker.has(x.workerId)) byWorker.set(x.workerId, []);
    byWorker.get(x.workerId).push(x);
  });

  const legend = Object.entries(CAT)
    .filter(([k]) => k !== 'normal' && k !== 'off')
    .map(([, v]) => `<span class="lg"><i style="background:${v.bg};border-color:${v.bd}"></i>${v.label}</span>`)
    .join('');

  let body = '';
  let grand = 0, grandAdj = 0;

  for (const [, list] of byWorker) {
    const w = list[0];
    const total = list.reduce((s, d) => s + d.amount, 0);
    const paidHrs = list.reduce((s, d) => s + d.paid, 0);
    const flags = list.filter((d) => d.issues.length).length;
    grand += total;

    body += `<h2>${esc(w.workerName)}
      <small>${w.workerType === 'monthly'
        ? `Monthly salary ${money(w.monthlySalary)} · one day ${money(w.unitValue)}`
        : `Daily wage · one day ${money(w.unitValue)}`} · overtime ${money(w.otRate)}/hr,
        ${money(w.otRateNight)}/hr after a night</small></h2>
      <table><thead><tr>
        <th>Date</th><th>In</th><th>Out</th><th>On the floor</th>
        <th>Paid hours</th><th class="n">Overtime</th><th class="n">Amount</th><th>Category</th>
      </tr></thead><tbody>`;

    for (const d of list) {
      const c = CAT[d.category] || CAT.normal;
      const flag = d.issues.length ? ` <b class="warn">${esc(d.issues[0])}</b>` : '';
      const longMark = d.longDay ? ' <em>· past the double night</em>' : '';
      body += `<tr style="background:${c.bg};border-left:4px solid ${c.bd}">
        <td class="dt">${prettyKey(d.key)}</td>
        <td>${hhmm(d.inAt)}</td>
        <td>${hhmm(d.outAt)}</td>
        <td>${fmtDuration(d.presence)}</td>
        <td>${fmtDuration(d.paid)}</td>
        <td class="n">${d.otHours ? d.otHours + ' hrs' : '—'}</td>
        <td class="n"${c.bold ? ' style="font-weight:700"' : ''}>${d.amount ? money(d.amount) : '—'}</td>
        <td style="color:${c.fg}">${c.label}${flag}${longMark}${d.note && d.note !== c.label ? ` <em>${esc(d.note)}</em>` : ''}</td>
      </tr>`;
    }

    const adj = wholeMonth ? (w.basisAdjust || 0) : 0;
    grandAdj += adj;
    body += `</tbody><tfoot><tr>
        <td colspan="4">${list.length} days${flags ? ` · ${flags} needing a check` : ''}</td>
        <td>${fmtDuration(paidHrs)}</td>
        <td class="n">${list.reduce((s, d) => s + d.otHours, 0).toFixed(2)} hrs</td>
        <td class="n">${money(total)}</td><td>Sum of days</td>
      </tr>${adj ? `<tr><td colspan="6"></td>
        <td class="n" style="color:var(--negative)">${adj > 0 ? '+' : '−'}${money(Math.abs(adj))}</td>
        <td>Rounding and 30-day basis</td></tr>
      <tr><td colspan="6"></td><td class="n"><b>${money(total + adj)}</b></td>
        <td><b>To pay</b></td></tr>` : ''}</tfoot></table>`;
  }

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>Attendance register ${from} to ${to}</title>
<link href="https://fonts.googleapis.com/css2?family=Alice&family=Lato:wght@400;700&display=swap" rel="stylesheet">
<style>
  body{font-family:"Lato",sans-serif;color:#243534;background:#faf8f3;margin:0;padding:34px 26px;font-size:13px}
  .hd{border-bottom:2px solid #385452;padding-bottom:14px;margin-bottom:8px}
  .hd h1{font-family:"Alice",serif;font-weight:400;font-size:27px;margin:0 0 3px}
  .hd p{margin:0;color:#4c7370;font-size:12.5px}
  .legend{margin:14px 0 22px;display:flex;flex-wrap:wrap;gap:7px 16px}
  .lg{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:#4c7370}
  .lg i{width:13px;height:13px;border-radius:3px;border:1px solid;display:inline-block}
  h2{font-family:"Alice",serif;font-weight:400;font-size:19px;margin:26px 0 8px;
     border-bottom:1px solid #e7e2d6;padding-bottom:5px}
  h2 small{font-family:"Lato",sans-serif;font-size:11.5px;color:#4c7370;font-weight:400;margin-left:9px}
  table{width:100%;border-collapse:collapse;margin-bottom:6px}
  th{text-align:left;font-size:10px;letter-spacing:.11em;text-transform:uppercase;color:#4c7370;
     padding:7px 9px;border-bottom:1px solid #385452;white-space:nowrap}
  td{padding:7px 9px;border-bottom:1px solid #f1ede3;font-variant-numeric:tabular-nums}
  th.n,td.n{text-align:right}
  td.dt{white-space:nowrap;font-weight:700}
  tfoot td{border-top:2px solid #385452;border-bottom:0;font-weight:700;background:#faf8f3}
  em{font-style:normal;color:#4c7370;font-size:11.5px}
  .warn{color:#a6503a;font-weight:700}
  .grand{margin-top:26px;background:#385452;color:#fff;border:1px solid #dbc078;border-radius:12px;
         padding:16px 20px;display:flex;justify-content:space-between;align-items:baseline}
  .grand span:first-child{font-family:"Alice",serif;font-size:19px}
  .grand span:last-child{font-size:23px;font-weight:700;color:#e6d3a0}
  .ft{margin-top:20px;color:#8a9694;font-size:11px;line-height:1.6}
  @media print{
    body{background:#fff;padding:0;font-size:11px}
    h2{page-break-after:avoid} tr{page-break-inside:avoid}
    .grand{background:#385452 !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    tr{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  }
</style></head><body>
<div class="hd">
  <h1>${esc(cfg.brand || 'Attendance')}</h1>
  <p>Daily attendance register · ${prettyKey(from)} to ${prettyKey(to)}</p>
</div>
<div class="legend">${legend}</div>
${body}
<div class="grand"><span>Total for the period</span><span>${money(grand + grandAdj)}</span></div>
<p class="ft">"On the floor" is punch-in to punch-out. "Paid hours" is that figure less the unpaid break.<br>
A monthly salary is divided by ${withDefaults(cfg).payDaysPerMonth} days, so one day never changes with the length of the month.
Sundays and declared closures are paid rest days; working one earns a second day on top.
A full day is ${cfg.standardHours} paid hours on a weekday and ${withDefaults(cfg).offDayStandardHours} on a rest day.
Six extra hours make a night, worth another full day; four beyond that make a double night, worth two.
Extra hours short of a night are overtime at one day divided by ${cfg.standardHours}. Every hour beyond a completed
night — including anything past the double night — is priced at one day divided by ${withDefaults(cfg).nightAfterHours},
because that is how long a night is.<br>
Daily-wage staff work a full ${cfg.standardHours}-hour day on every day including Sundays.<br>
${wholeMonth ? '' : 'This range is not a whole month, so no 30-day basis adjustment is applied — check the Payroll tab for a full month. '}Generated ${new Date().toLocaleString('en-IN')}. Days marked for a check have a missing punch — fix those before paying.</p>
</body></html>`;

  saveFile(html, `register-${from}-to-${to}.html`, 'text/html');
}

function downloadCsvRegister(rows, from, to) {
  const head = ['Worker', 'Pay type', 'Date', 'Punch in', 'Punch out', 'On the floor',
    'Paid hours', 'Hours decimal', 'Day units', 'Overtime hours', 'Amount',
    'Category', 'Note', 'Needs check'];
  const lines = [head.join(',')];
  for (const d of rows) {
    lines.push([
      `"${d.workerName}"`, d.workerType, d.key,
      hhmm(d.inAt), hhmm(d.outAt),
      `"${fmtDuration(d.presence)}"`, `"${fmtDuration(d.paid)}"`,
      d.paid, d.units, d.otHours, d.amount,
      (CAT[d.category] || CAT.normal).label,
      `"${d.note || ''}"`, `"${d.issues.join('; ')}"`,
    ].join(','));
  }
  lines.push(['TOTAL', ...Array(9).fill(''), rows.reduce((s, d) => s + d.amount, 0), '', '', ''].join(','));
  saveFile(lines.join('\n'), `register-${from}-to-${to}.csv`, 'text/csv');
}

function saveFile(text, name, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* service worker */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
