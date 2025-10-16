// server.js — Sheets-backed with aggressive caching to avoid 429s
require('dotenv').config();
const express = require('express');
const path = require('path');
const { google } = require('googleapis');
const finalhandler = require('finalhandler');

const app = express();

app.get('/healthz', (req, res) => res.status(200).send('ok'));

/* ========= ENV ========= */
const {
  GOOGLE_SHEET_ID,
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_PRIVATE_KEY,

  SHEET_AVAIL_TAB = 'Availability',
  SHEET_BOOKINGS_TAB = 'Bookings',
  SHEET_BLACKOUTS_TAB = 'Blackouts',

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

/* ========= ✅ Sitemap & Robots.txt Fix ========= */
app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml');
  res.sendFile(path.join(PUBLIC_DIR, 'sitemap.xml'));
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.sendFile(path.join(PUBLIC_DIR, 'robots.txt'));
});

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
let snapshot = { ts: 0, availRows: null, bookingRows: null, blackoutSet: new Set() };
let inflight = null;

async function loadSnapshot(force = false) {
  const now = Date.now();
  if (!force && snapshot.ts && (now - snapshot.ts) < SNAPSHOT_TTL_MS && snapshot.availRows) return snapshot;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const [availRows, bookingRows, blackoutRows] = await Promise.all([
        getValues(`${SHEET_AVAIL_TAB}!A2:I`),
        getValues(`${SHEET_BOOKINGS_TAB}!A2:N`),
        getValues(`${SHEET_BLACKOUTS_TAB}!A2:B`).catch(() => [])
      ]);

      const blackoutSet = new Set();
      for (const r of (blackoutRows || [])) {
        const iso = parseSheetDateToISO(r[0] || '');
        const active = String(r[1] || '').trim().toUpperCase();
        if (iso && (active === 'TRUE' || active === '1' || active === 'YES')) blackoutSet.add(iso);
      }

      snapshot = { ts: Date.now(), availRows, bookingRows, blackoutSet };
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

/* ========= APIs ========= */
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
      const hasOpen = true; // simplified for example
      if (hasOpen) openDates.push(iso);
    }

    res.json({ dates: openDates });
  } catch (e) {
    console.error('GET /api/available-dates', e);
    res.status(503).json({ dates: [] });
  }
});

/* ========= Routes ========= */
app.get('/',           (req, res) => res.sendFile(path.join(VIEWS_DIR, 'index.html')));
app.get('/services',   (req, res) => res.sendFile(path.join(VIEWS_DIR, 'services.html')));
app.get('/datetime',   (req, res) => res.sendFile(path.join(VIEWS_DIR, 'datetime.html')));
app.get('/checkout',   (req, res) => res.sendFile(path.join(VIEWS_DIR, 'checkout.html')));
app.get('/thankyou',   (req, res) => res.sendFile(path.join(VIEWS_DIR, 'Thankyou.html')));
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
app.get('/privacy',    (req, res) => res.sendFile(path.join(VIEWS_DIR, 'privacy.html')));
app.get('/terms',      (req, res) => res.sendFile(path.join(VIEWS_DIR, 'terms.html')));

app.get(['/Contact', '/Contact.html'], (req, res) => res.redirect(301, '/contact'));

/* ========= Start ========= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
