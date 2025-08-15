// server.js — Sheets-backed with aggressive caching to avoid 429s
require('dotenv').config();
const express = require('express');
const path = require('path');
const { google } = require('googleapis');

const app = express();

app.get('/healthz', (req, res) => {
  res.status(200).send('ok');
});

/* ========= ENV ========= */
const {
  GOOGLE_SHEET_ID,
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_PRIVATE_KEY,
  SHEET_AVAIL_TAB = 'Availability',
  SHEET_BOOKINGS_TAB = 'Bookings',

  MIN_LEAD_MINUTES = '0',
  SAME_DAY_CUTOFF_MIN = '0',
  MAX_BOOK_DAYS_AHEAD = '60',

  DEFAULT_TAX_RATE = '0',
  HOME_BASE_ADDRESS = '',
  MILEAGE_FREE_MILES = '0',
  MILEAGE_RATE = '0',
  GMAPS_KEY = '',

  DRIVE_ROUND_TRIP = 'true'
} = process.env;

const MIN_LEAD   = Number(MIN_LEAD_MINUTES) || 0;
const SAME_DAY_C = Number(SAME_DAY_CUTOFF_MIN) || 0;
const MAX_AHEAD  = Number(MAX_BOOK_DAYS_AHEAD) || 60;
const TAX_RATE   = Number(DEFAULT_TAX_RATE) || 0;
const FREE_MILES = Number(MILEAGE_FREE_MILES) || 0;
const MILE_RATE  = Number(MILEAGE_RATE) || 0;
const USE_ROUND_TRIP = String(DRIVE_ROUND_TRIP).toLowerCase() !== 'false';

/* ========= App & Static ========= */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PUBLIC_DIR = path.join(__dirname, 'public');
const VIEWS_DIR  = path.join(__dirname, 'views');

app.use(express.static(PUBLIC_DIR));
app.use('/public', express.static(PUBLIC_DIR));
app.use('/Images', express.static(path.join(__dirname, 'Images')));
app.use(express.static(VIEWS_DIR));

/* ========= Google Sheets Auth ========= */
let sheetsClient = null;
async function getSheets() {
  if (sheetsClient) return sheetsClient;
  let auth;
  if (GOOGLE_SERVICE_ACCOUNT_EMAIL && GOOGLE_PRIVATE_KEY) {
    auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  } else {
    auth = new google.auth.GoogleAuth({
      keyFile: 'credentials.json',
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

/* ========= Sheets helpers ========= */
async function getValues(range) {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range,
  });
  return res.data.values || [];
}
async function appendValues(range, rows) {
  const sheets = await getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
}

/* ========= Cache ========= */
const SNAPSHOT_TTL_MS = 30_000;
let snapshot = { ts: 0, availRows: null, bookingRows: null };
let inflight = null;

async function loadSnapshot(force = false) {
  const now = Date.now();
  if (!force && snapshot.ts && (now - snapshot.ts) < SNAPSHOT_TTL_MS && snapshot.availRows) return snapshot;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const [availRows, bookingRows] = await Promise.all([
        getValues(`${SHEET_AVAIL_TAB}!A2:I`),
        getValues(`${SHEET_BOOKINGS_TAB}!A2:N`)
      ]);
      snapshot = { ts: Date.now(), availRows, bookingRows };
      return snapshot;
    } catch (err) {
      if (snapshot.availRows) {
        console.warn('⚠️ Sheets quota/error; serving cached snapshot:', err?.code || err?.message || err);
        return snapshot;
      }
      throw err;
    } finally { inflight = null; }
  })();

  return inflight;
}

/* ========= Time & date helpers ========= */
function timeToMinutes(t) {
  const [hh, mm] = String(t || '00:00').split(':').map(Number);
  return (hh * 60) + (mm || 0);
}
function minutesToTime(m) {
  const hh = ((Math.floor(m / 60) % 24) + 24) % 24;
  const mm = ((m % 60) + 60) % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
function to12h(hhmm) {
  const [H, M] = String(hhmm || '').split(':').map(Number);
  if (!Number.isFinite(H) || !Number.isFinite(M)) return hhmm || '';
  const ampm = H >= 12 ? 'PM' : 'AM';
  const h = ((H + 11) % 12) + 1;
  return `${h}:${String(M).padStart(2, '0')} ${ampm}`;
}
function parseSheetTimeToHHMM(cell) {
  const s = String(cell || '').trim().toUpperCase();
  if (!s) return null;
  let m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/);
  if (m) {
    let h = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const ap = m[3];
    if (ap === 'PM' && h !== 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
  }
  m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m) return `${String(parseInt(m[1],10)).padStart(2,'0')}:${String(parseInt(m[2],10)).padStart(2,'0')}`;
  return null;
}
function parseSheetDateToISO(cell) {
  const s = String(cell || '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const mm = String(parseInt(m[1],10)).padStart(2,'0');
    const dd = String(parseInt(m[2],10)).padStart(2,'0');
    return `${m[3]}-${mm}-${dd}`;
  }
  const d = new Date(s);
  if (!isNaN(d)) {
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  }
  return null;
}
function withinWindow(dateStr, timeStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const now = new Date();
  const slot = new Date(`${dateStr}T${timeStr}:00`);
  if (MAX_AHEAD > 0) {
    const last = new Date();
    last.setDate(last.getDate() + MAX_AHEAD);
    last.setHours(23,59,59,999);
    if (slot > last) return false;
  }
  if (MIN_LEAD > 0) {
    const minStart = new Date(now.getTime() + MIN_LEAD * 60000);
    if (slot < minStart) return false;
  }
  const sameDay = slot.toDateString() === now.toDateString();
  if (sameDay && SAME_DAY_C > 0) {
    const cutoff = new Date(now.getTime() + SAME_DAY_C * 60000);
    if (slot < cutoff) return false;
  }
  return true;
}

/* ========= Capacity (subtract across full booking window) ========= */
function capacityMapForDateFromSnapshot(dateISO, snap) {
  const { availRows = [], bookingRows = [] } = snap || {};
  const cap = new Map();

  // Availability rows
  for (const r of availRows) {
    const rowDateISO = parseSheetDateToISO(r[2] || '');
    const active  = String(r[7] || '').toUpperCase();
    if (rowDateISO !== dateISO) continue;
    if (!(active === 'TRUE' || active === '1')) continue;

    const start    = r[3] || '';
       const end      = r[4] || '';
    const slotMins = Math.max(5, Number(r[5] || 30));
    const capacity = Math.max(0, Number(r[6] || 1));

    const startM = timeToMinutes(start);
    const endM   = timeToMinutes(end);
    if (!Number.isFinite(startM) || !Number.isFinite(endM) || endM <= startM) continue;

    for (let m = startM; m < endM; m += slotMins) {
      const t = minutesToTime(m);
      cap.set(t, (cap.get(t) || 0) + capacity);
    }
  }

  // Subtract bookings across [start, end)
  for (const b of bookingRows) {
    const bDateISO = parseSheetDateToISO(b[1] || '');
    if (bDateISO !== dateISO) continue;

    const rawStart = b[7] || '';
    const rawEnd   = b[8] || '';
    const startHH  = parseSheetTimeToHHMM(rawStart);
    const endHH    = parseSheetTimeToHHMM(rawEnd);

    if (!startHH) continue;
    const startM = timeToMinutes(startHH);
    const endM   = Number.isFinite(timeToMinutes(endHH)) ? timeToMinutes(endHH) : null;

    if (endM && endM > startM) {
      for (const [t, c] of cap.entries()) {
        const tm = timeToMinutes(t);
        if (tm >= startM && tm < endM) cap.set(t, Math.max(0, (c || 0) - 1));
      }
    } else {
      if (cap.has(startHH)) cap.set(startHH, Math.max(0, (cap.get(startHH) || 0) - 1));
    }
  }

  return cap;
}

/* ========= Duration model ========= */
const BASE_PKG_MINUTES = {
  'Basic Detailing Package': 120,
  'Thorough Detailing Package': 180,
  'Like-New Refurbished Detailing': 300,
};
function baseMinutesForPackageName(pkgName = '') {
  const name = String(pkgName).toLowerCase();
  if (BASE_PKG_MINUTES[pkgName]) return BASE_PKG_MINUTES[pkgName];
  if (name.includes('like-new')) return 300;
  if (name.includes('thorough')) return 180;
  if (name.includes('basic')) return 120;
  if (name.includes('showroom')) return 300;
  return 120;
}
const SIZE_BUMP = { car: 0, suv: 10, truck: 20 };
const HAIR_MIN = { none: 0, normal: 15, heavy: { car: 30, suv: 40, truck: 50 } };
const LEVEL_MIN = { none: 0, light: 15, medium: 30, heavy: 45 };
const PAINT_MIN = { car: 90, suv: 120, truck: 150 };

function computeServiceMinutes(selection = {}) {
  const pkgName = selection.packageName || '';
  const sizeId = (selection.sizeId || '').toLowerCase();
  const sizeFromLabel = (selection.sizeLabel || '').toLowerCase().includes('truck') ? 'truck'
    : (selection.sizeLabel || '').toLowerCase().includes('suv') ? 'suv'
    : 'car';
  const size = sizeId || sizeFromLabel;

  let total = baseMinutesForPackageName(pkgName);
  total += SIZE_BUMP[size] || 0;

  const hairLevel = (selection.hair && selection.hair.level) || selection.petHair || selection.petHairLevel || 'none';
  if (hairLevel === 'heavy') total += (HAIR_MIN.heavy[size] || 30);
  else if (hairLevel === 'normal') total += HAIR_MIN.normal;

  const stainLevel = (selection.stain && selection.stain.level) || selection.staining || selection.stainLevel || 'none';
  total += LEVEL_MIN[stainLevel] || 0;

  const odorLevel = (selection.odor && selection.odor.level) || selection.deepOdor || selection.odorLevel || 'none';
  total += LEVEL_MIN[odorLevel] || 0;

  const addons = Array.isArray(selection.addons) ? selection.addons : [];
  const hasPaint = addons.some(a => (a?.id || a?.name || a) && String(a?.id || a?.name || a).toLowerCase().includes('paint'));
  if (hasPaint) total += PAINT_MIN[size] || 90;

  return total;
}

/* ========= Helpers ========= */
function hasCapacityForRange(capMap, startM, endM) {
  for (const [t, c] of capMap.entries()) {
    const tm = timeToMinutes(t);
    if (tm >= startM && tm < endM) {
      if ((c || 0) <= 0) return false;
    }
  }
  return true;
}

/* ========= APIs ========= */

// Month -> open dates (Sundays allowed)
app.get('/api/available-dates', async (req, res) => {
  try {
    const y = parseInt(req.query.year, 10);
    const m = parseInt(req.query.month, 10);
    if (!y || !m || m < 1 || m > 12) return res.status(400).json({ dates: [] });

    const snap = await loadSnapshot();

    const lastDay = new Date(y, m, 0).getDate();
    const openDates = [];

    for (let d = 1; d <= lastDay; d++) {
      const dt = new Date(y, m - 1, d);
      const iso = dt.toISOString().slice(0,10);
      const capMap = capacityMapForDateFromSnapshot(iso, snap);
      const hasOpen = [...capMap.entries()].some(([t, c]) => c > 0 && withinWindow(iso, t));
      if (hasOpen) openDates.push(iso);
    }

    res.json({ dates: openDates });
  } catch (e) {
    console.error('GET /api/available-dates', e);
    res.status(503).json({ dates: [] });
  }
});

// Date -> open slots (capacity > 0)
app.get('/api/availability', async (req, res) => {
  try {
    const date = String(req.query.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ slots: [] });

    const snap = await loadSnapshot();
    const capMap = capacityMapForDateFromSnapshot(date, snap);

    const slots = [...capMap.keys()]
      .sort()
      .map(time => ({
        time,
        capacity: withinWindow(date, time) ? (capMap.get(time) || 0) : 0
      }))
      .filter(s => s.capacity > 0);

    res.json({ date, slots });
  } catch (e) {
    console.error('GET /api/availability', e);
    res.status(503).json({ slots: [] });
  }
});

// Confirm booking (full guard; includes travel if address provided)
app.post('/api/confirm-booking', async (req, res) => {
  try {
    const { selection, appointment, customer, pricing } = req.body || {};
    if (!selection || !appointment || !customer) {
      return res.status(400).json({ error: 'Missing booking payload' });
    }
    const date = String(appointment.date || '');
    const startTime = String(appointment.time || '');
    // ✅ FIXED: correct date regex
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(startTime))
      return res.status(400).json({ error: 'Bad date/time' });

    // Durations (service + travel if address present)
    const serviceMin = computeServiceMinutes(selection);
    const addressStr = [
      customer.address?.street, customer.address?.city,
      customer.address?.state, customer.address?.zip
    ].filter(Boolean).join(', ');
    let driveMin = 0;
    if (GMAPS_KEY && HOME_BASE_ADDRESS && addressStr) {
      try {
        const params = new URLSearchParams({
          origins: HOME_BASE_ADDRESS,
          destinations: addressStr,
          key: GMAPS_KEY,
          units: 'imperial',
          departure_time: 'now',
          traffic_model: 'best_guess'
        });
        const url = `https://maps.googleapis.com/maps/api/distancematrix/json?${params.toString()}`;
        const r = await fetch(url);
        if (r.ok) {
          const j = await r.json();
          const el = j?.rows?.[0]?.elements?.[0];
          if (el?.status === 'OK') {
            const durSec = (el.duration_in_traffic?.value ?? el.duration?.value) || 0;
            driveMin = Math.round(durSec / 60) * (USE_ROUND_TRIP ? 2 : 1);
          }
        }
      } catch {}
    }
    const totalJobMinutes = serviceMin + driveMin;

    // Capacity check across full window
    const snap = await loadSnapshot(true);
    const capMap = capacityMapForDateFromSnapshot(date, snap);
    const startM = timeToMinutes(startTime);
    const endM   = startM + totalJobMinutes;

    if (!hasCapacityForRange(capMap, startM, endM)) {
      return res.status(409).json({
        error: 'overlap',
        message: 'That start time won’t fit the full service duration (includes travel). Please choose another time.'
      });
    }

    // Times for sheet (store 12h)
    const startDisplay = to12h(minutesToTime(startM));
    const endDisplay   = to12h(minutesToTime(endM));

    // Build row
    const existingA = await getValues(`${SHEET_BOOKINGS_TAB}!A2:A`);
    let max = 0;
    for (const r of (existingA || [])) {
      const a = r[0] || '';
      const m = String(a).match(/JOB-(\d+)/i);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    const jobId = `JOB-${String(max + 1).padStart(3, '0')}`;

    const customerName = customer.name || '';
    const email = customer.email || '';
    const phone = customer.phone || '';

    const pkg   = selection.packageName || '';
    const size  = selection.sizeLabel || '';
    const addons = Array.isArray(selection.addons)
      ? selection.addons.map(a => a.name || a).join(', ')
      : '';
    const heard = customer.heardFrom || '';
    const total = Number(pricing?.total || 0);
    const addressStr2 = [
      customer.address?.street, customer.address?.city,
      customer.address?.state, customer.address?.zip
    ].filter(Boolean).join(', ');

    await appendValues(`${SHEET_BOOKINGS_TAB}!A2`, [[
      jobId, date, customerName, pkg, size, addons, total,
      startDisplay, endDisplay, heard, email, phone, addressStr2, '', ''
    ]]);

    // Invalidate cache after write
    snapshot.ts = 0;

    res.json({ ok: true, jobId, start: startDisplay, end: endDisplay });
  } catch (e) {
    console.error('POST /api/confirm-booking', e);
    res.status(503).json({ error: 'Failed to confirm booking' });
  }
});

/* ========= Estimate ========= */
app.post('/api/estimate', async (req, res) => {
  try {
    const { address = '', zip = '', subtotal = 0 } = req.body || {};
    const sub = Number(subtotal) || 0;

    let miles = 0;
    let minutes = 0;
    if (GMAPS_KEY && HOME_BASE_ADDRESS && address) {
      const params = new URLSearchParams({
        origins: HOME_BASE_ADDRESS,
        destinations: address,
        key: GMAPS_KEY,
        units: 'imperial',
        departure_time: 'now',
        traffic_model: 'best_guess'
      });
      const url = `https://maps.googleapis.com/maps/api/distancematrix/json?${params.toString()}`;
      const r = await fetch(url);
      if (r.ok) {
        const j = await r.json();
        const el = j?.rows?.[0]?.elements?.[0];
        if (el?.status === 'OK') {
          const txt = el.distance?.text || '';
          miles = parseFloat(String(txt).replace(/[^\d.]/g, '')) || 0;
          const durSec = (el.duration_in_traffic?.value ?? el.duration?.value) || 0;
          minutes = Math.round(durSec / 60);
        }
      }
    }
    const billable = Math.max(0, miles - FREE_MILES);
    const mileageFee = billable * MILE_RATE;
    const taxAmount = Math.max(0, sub + mileageFee) * TAX_RATE;
    const total = sub + mileageFee + taxAmount;

    res.json({
      miles: Math.round(miles * 100) / 100,
      driveMinutesOneWay: minutes,
      billableMiles: Math.round(billable * 100) / 100,
      mileageFee: Math.round(mileageFee * 100) / 100,
      taxRate: TAX_RATE,
      taxAmount: Math.round(taxAmount * 100) / 100,
      total: Math.round(total * 100) / 100
    });
  } catch (e) {
    const sub = Number(req.body?.subtotal || 0);
    const tax = Math.max(0, sub) * TAX_RATE;
    res.json({ miles: 0, driveMinutesOneWay: 0, billableMiles: 0, mileageFee: 0, taxRate: TAX_RATE, taxAmount: tax, total: sub + tax });
  }
});

/* ========= Aliases & Routes ========= */
const finalhandler = require('finalhandler');
app.get('/api/slots', (req, res) => {
  req.url = '/api/availability' + (req._parsedUrl.search || '');
  app._router.handle(req, res, finalhandler(req, res));
});
app.post('/api/book', (req, res) => {
  req.url = '/api/confirm-booking';
  app._router.handle(req, res, finalhandler(req, res));
});

app.get('/',           (req, res) => res.sendFile(path.join(VIEWS_DIR, 'index.html')));
app.get('/services',   (req, res) => res.sendFile(path.join(VIEWS_DIR, 'services.html')));
app.get('/datetime',   (req, res) => res.sendFile(path.join(VIEWS_DIR, 'datetime.html')));
app.get('/checkout',   (req, res) => res.sendFile(path.join(VIEWS_DIR, 'checkout.html')));
app.get('/packages',   (req, res) => res.sendFile(path.join(VIEWS_DIR, 'packages.html')));
app.get('/blogs',      (req, res) => res.sendFile(path.join(VIEWS_DIR, 'blogs.html')));
app.get('/blog1',      (req, res) => res.sendFile(path.join(VIEWS_DIR, 'blog1.html')));
app.get('/blog2',      (req, res) => res.sendFile(path.join(VIEWS_DIR, 'blog2.html')));
app.get('/blog3',      (req, res) => res.sendFile(path.join(VIEWS_DIR, 'blog3.html')));
app.get('/blog4',      (req, res) => res.sendFile(path.join(VIEWS_DIR, 'blog4.html')));
app.get('/contact',    (req, res) => res.sendFile(path.join(VIEWS_DIR, 'contact.html')));
app.get('/fleet',      (req, res) => res.sendFile(path.join(VIEWS_DIR, 'fleet.html')));
app.get('/freestuff',  (req, res) => res.sendFile(path.join(VIEWS_DIR, 'freestuff.html')));
app.get('/mobile',     (req, res) => res.sendFile(path.join(VIEWS_DIR, 'mobile.html')));

/* ========= Start ========= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});


