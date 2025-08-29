// routes/employees.js
// Employees: invite → signup → login → me → update profile
// + Persistent Availability Template (multi-time ranges per weekday)
// + Blackouts (one-off dates)
//
// EmployeeProfiles (A..J):
// A employeeId | B email | C firstName | D lastName | E phone | F password (PLAIN) | G active | H signupToken | I signupExpires | J createdAt
//
// Availability template tab (persistent) (A..G):
// A employeeId | B weekday(mon..sun) | C slot(1..N) | D startTime(HH:mm) | E endTime(HH:mm) | F notes | G updatedAt
//
// Blackouts tab (A..D):
// A employeeId | B date(YYYY-MM-DD) | C note | D createdAt

const express = require('express');
const { google } = require('googleapis');
const crypto = require('crypto');

const router = express.Router();

const SHEET_ID        = process.env.GOOGLE_SHEET_ID;
const EMPS_TAB        = process.env.SHEET_EMPS        || 'EmployeeProfiles';
const AVAIL_TAB       = process.env.SHEET_AVAIL       || 'Availability';     // persistent template
const BLACKOUTS_TAB   = process.env.SHEET_BLACKOUTS   || 'Blackouts';
const BASE_URL        = process.env.APP_BASE_URL      || 'http://localhost:3000';

if (!SHEET_ID) console.warn('[employees] Missing GOOGLE_SHEET_ID env');

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

// EmployeeProfiles ranges
const RANGE_BODY = 'A2:J';

// Availability template ranges
const AVAIL_RANGE = 'A2:G';

// Blackouts ranges
const BL_RANGE = 'A2:D';

const COL = {
  employeeId: 0, email: 1, firstName: 2, lastName: 3, phone: 4,
  password: 5, active: 6, signupToken: 7, signupExpires: 8, createdAt: 9
};

const TCOL = {
  employeeId: 0,    // A
  weekday: 1,       // B  mon..sun
  slot: 2,          // C  1..N
  start: 3,         // D  HH:mm (or numeric fraction-of-day)
  end: 4,           // E  HH:mm (or numeric fraction-of-day)
  notes: 5,         // F
  updatedAt: 6      // G
};

const BLCOL = {
  employeeId: 0,   // A
  date: 1,         // B  YYYY-MM-DD
  note: 2,         // C
  createdAt: 3     // D
};

const DAY_KEYS = ['mon','tue','wed','thu','fri','sat','sun'];

async function getSheets() {
  const auth = await google.auth.getClient({ scopes: SCOPES });
  return google.sheets({ version: 'v4', auth });
}

const isoNow = () => new Date().toISOString();
const pad3 = (n) => String(n).padStart(3, '0');
const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());
function toBoolean(v) {
  if (v === true) return true;
  const s = String(v || '').trim().toUpperCase();
  return s === 'TRUE' || s === 'YES' || s === '1' || s === 'CHECKED';
}

// --- convert Sheets time (fraction-of-day or string) → "HH:mm"
function fmtTime(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') {
    const mins = Math.round(v * 24 * 60);
    const hh = String(Math.floor(mins / 60)).padStart(2, '0');
    const mm = String(mins % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (m) return `${m[1].padStart(2,'0')}:${m[2]}`;
  if (/^\d*\.?\d+$/.test(s)) {
    const num = parseFloat(s);
    if (!isNaN(num)) return fmtTime(num);
  }
  return s;
}

// ---------------- EmployeeProfiles helpers ----------------
async function readAllRows() {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${EMPS_TAB}!${RANGE_BODY}`,
    valueRenderOption: 'UNFORMATTED_VALUE',
    majorDimension: 'ROWS'
  });
  return res.data.values || [];
}
async function updateRow(sheetRowNumber, rowArray) {
  const sheets = await getSheets();
  const range = `${EMPS_TAB}!A${sheetRowNumber}:J${sheetRowNumber}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [rowArray] }
  });
}
async function appendRow(rowArray) {
  const sheets = await getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${EMPS_TAB}!A:J`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [rowArray] }
  });
}
function buildRowArray(existing = []) {
  const base = new Array(10).fill('');
  for (let i = 0; i < Math.min(existing.length, 10); i++) base[i] = existing[i];
  return base;
}
function nextEmployeeId(rows) {
  let maxNum = 0;
  for (const r of rows) {
    const id = (r[COL.employeeId] || '').toString().trim();
    if (id.startsWith('E')) {
      const n = parseInt(id.slice(1), 10);
      if (Number.isFinite(n) && n > maxNum) maxNum = n;
    }
  }
  return `E${pad3(maxNum + 1)}`;
}
function findRowBy(rows, predicate) {
  const idx = rows.findIndex(predicate);
  if (idx === -1) return null;
  const sheetRow = 2 + idx; // header is row 1
  return { idx, sheetRow, row: rows[idx] };
}

// ---------------- Availability Template helpers ----------------
async function readAllTemplateRows() {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${AVAIL_TAB}!${AVAIL_RANGE}`,
    valueRenderOption: 'UNFORMATTED_VALUE',
    majorDimension: 'ROWS'
  });
  const rows = res.data.values || [];
  return rows.map((r, i) => ({ sheetRow: 2 + i, row: r }));
}

async function clearTemplateForEmployee(employeeId) {
  const sheets = await getSheets();
  const all = await readAllTemplateRows();
  const mine = all.filter(x => (x.row[TCOL.employeeId] || '').toString().trim() === employeeId);
  for (const x of mine) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${AVAIL_TAB}!A${x.sheetRow}:G${x.sheetRow}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['','','','','','','']] }
    });
  }
}

async function appendTemplateRows(rowsArrays) {
  if (!rowsArrays.length) return;
  const sheets = await getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${AVAIL_TAB}!A:G`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rowsArrays }
  });
}

// ---------------- Blackouts helpers ----------------
async function readAllBlackouts() {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${BLACKOUTS_TAB}!${BL_RANGE}`,
    valueRenderOption: 'UNFORMATTED_VALUE',
    majorDimension: 'ROWS'
  });
  const rows = res.data.values || [];
  return rows.map((r, i) => ({ sheetRow: 2 + i, row: r }));
}

async function setBlackoutsForEmployee(employeeId, dates, note) {
  const sheets = await getSheets();
  const all = await readAllBlackouts();
  // Clear existing
  const mine = all.filter(x => (x.row[BLCOL.employeeId] || '').toString().trim() === employeeId);
  for (const x of mine) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${BLACKOUTS_TAB}!A${x.sheetRow}:D${x.sheetRow}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['','','','']] }
    });
  }
  // Append new
  if (Array.isArray(dates) && dates.length) {
    const createdAt = isoNow();
    const rows = dates.map(d => [employeeId, String(d), note || '', createdAt]);
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${BLACKOUTS_TAB}!A:D`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: rows }
    });
  }
}

// ===================================================================
//                          EMPLOYEE ROUTES
// ===================================================================

// POST /api/employees/invite  { email }
router.post('/invite', async (req, res) => {
  try {
    const emailRaw = (req.body?.email || '').trim();
    if (!isValidEmail(emailRaw)) return res.status(400).json({ ok:false, error:'Invalid email' });

    const rows = await readAllRows();
    const found = findRowBy(rows, r => (r[COL.email] || '').toString().trim().toLowerCase() === emailRaw.toLowerCase());

    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 24*60*60*1000).toISOString();
    const createdAt = isoNow();

    if (found) {
      const r = buildRowArray(found.row);
      if (toBoolean(r[COL.active])) return res.status(400).json({ ok:false, error:'Email already active' });
      if (!r[COL.employeeId]) r[COL.employeeId] = nextEmployeeId(rows);
      r[COL.signupToken] = token;
      r[COL.signupExpires] = expiresAt;
      r[COL.createdAt] = r[COL.createdAt] || createdAt;
      r[COL.active] = false;
      await updateRow(found.sheetRow, r);
      const signupUrl = `${BASE_URL.replace(/\/$/, '')}/employee/signup?token=${encodeURIComponent(token)}`;
      return res.json({ ok:true, employeeId: r[COL.employeeId], signupUrl });
    }

    const employeeId = nextEmployeeId(rows);
    const newRow = buildRowArray();
    newRow[COL.employeeId] = employeeId;
    newRow[COL.email] = emailRaw;
    newRow[COL.firstName] = '';
    newRow[COL.lastName] = '';
    newRow[COL.phone] = '';
    newRow[COL.password] = ''; // plain password set at signup
    newRow[COL.active] = false;
    newRow[COL.signupToken] = token;
    newRow[COL.signupExpires] = expiresAt;
    newRow[COL.createdAt] = createdAt;
    await appendRow(newRow);

    const signupUrl = `${BASE_URL.replace(/\/$/, '')}/employee/signup?token=${encodeURIComponent(token)}`;
    return res.json({ ok:true, employeeId, signupUrl });
  } catch (err) {
    console.error('[employees/invite]', err);
    return res.status(500).json({ ok:false, error:'Server error' });
  }
});

// POST /api/employees/signup  { token, firstName, lastName, phone, password }
router.post('/signup', async (req, res) => {
  try {
    const { token, firstName, lastName, phone, password } = req.body || {};
    if (!token || !password || !firstName || !lastName)
      return res.status(400).json({ ok:false, error:'Missing required fields' });

    const rows = await readAllRows();
    const found = findRowBy(rows, r => (r[COL.signupToken] || '') === token);
    if (!found) return res.status(400).json({ ok:false, error:'Invalid token' });

    const r = buildRowArray(found.row);
    const expires = r[COL.signupExpires] ? new Date(r[COL.signupExpires]) : null;
    if (!expires || Date.now() > expires.getTime()) return res.status(400).json({ ok:false, error:'Token expired' });

    r[COL.firstName] = String(firstName).trim();
    r[COL.lastName]  = String(lastName).trim();
    r[COL.phone]     = String(phone || '').trim();
    r[COL.password]  = String(password); // PLAIN, per your design
    r[COL.active] = true;
    r[COL.signupToken] = '';
    r[COL.signupExpires] = '';
    await updateRow(found.sheetRow, r);

    return res.json({ ok:true, employeeId: r[COL.employeeId] });
  } catch (err) {
    console.error('[employees/signup]', err);
    return res.status(500).json({ ok:false, error:'Server error' });
  }
});

// POST /api/employees/login  { email, password }
// ✅ sets express-session; redirects handled on client using response.redirect
router.post('/login', async (req, res) => {
  try {
    const emailRaw = (req.body?.email || '').trim();
    const password = String(req.body?.password || '');
    if (!isValidEmail(emailRaw) || !password)
      return res.status(400).json({ ok:false, error:'Invalid credentials' });

    const rows = await readAllRows();
    const found = findRowBy(rows, r => (r[COL.email] || '').toString().trim().toLowerCase() === emailRaw.toLowerCase());
    if (!found) return res.status(400).json({ ok:false, error:'User not found' });

    const r = buildRowArray(found.row);
    if (!toBoolean(r[COL.active])) return res.status(403).json({ ok:false, error:'Account inactive' });

    const ok = password === String(r[COL.password] || '');
    if (!ok) return res.status(400).json({ ok:false, error:'Invalid credentials' });

    // ✅ Prevent session fixation and set session.user
    req.session.regenerate((err) => {
      if (err) {
        console.error('[session] regenerate failed', err);
        return res.status(500).json({ ok:false, error:'Session error' });
      }
      req.session.user = {
        employeeId: r[COL.employeeId],
        firstName: r[COL.firstName] || '',
        lastName: r[COL.lastName] || '',
        email: r[COL.email]
      };
      // Save explicitly to ensure cookie is set before response
      req.session.save((err2) => {
        if (err2) {
          console.error('[session] save failed', err2);
          return res.status(500).json({ ok:false, error:'Session error' });
        }
        return res.json({
          ok: true,
          employeeId: r[COL.employeeId],
          firstName: r[COL.firstName] || '',
          lastName: r[COL.lastName] || '',
          redirect: '/employee/jobboard'
        });
      });
    });
  } catch (err) {
    console.error('[employees/login]', err);
    return res.status(500).json({ ok:false, error:'Server error' });
  }
});

// POST /api/employees/logout  → clears session
router.post('/logout', (req, res) => {
  if (!req.session) return res.json({ ok: true });
  req.session.destroy((err) => {
    if (err) {
      console.error('[session] destroy failed', err);
      return res.status(500).json({ ok:false, error:'Session error' });
    }
    res.clearCookie('connect.sid');
    return res.json({ ok:true });
  });
});

// GET /api/employees/session → debug current session user
router.get('/session', (req, res) => {
  const u = req.session?.user || null;
  return res.json({ ok: true, user: u });
});

// GET /api/employees/me
router.get('/me', async (req, res) => {
  try {
    const id = req.session?.user?.employeeId;
    if (!id) {
      return res.status(401).json({ ok:false, error:'Not logged in' });
    }

    const rows = await readAllRows();
    const found = findRowBy(rows, r => (r[COL.employeeId] || '').toString().trim() === id);
    if (!found) {
      return res.status(404).json({ ok:false, error:'Not found' });
    }

    const r = buildRowArray(found.row);
    return res.json({
      ok: true,
      profile: {
        employeeId: r[COL.employeeId],
        email: r[COL.email],
        firstName: r[COL.firstName] || '',
        lastName: r[COL.lastName] || '',
        phone: r[COL.phone] || '',
        active: !!toBoolean(r[COL.active]),
        createdAt: r[COL.createdAt] || ''
      }
    });
  } catch (err) {
    console.error('[employees/me]', err);
    return res.status(500).json({ ok:false, error:'Server error' });
  }
});

// PUT /api/employees/me  { employeeId, firstName?, lastName?, phone?, password? }
router.put('/me', async (req, res) => {
  try {
    const { employeeId, firstName, lastName, phone, password } = req.body || {};
    const id = String(employeeId || '').trim();
    if (!id) return res.status(400).json({ ok:false, error:'Missing employeeId' });

    const rows = await readAllRows();
    const found = findRowBy(rows, r => (r[COL.employeeId] || '').toString().trim() === id);
    if (!found) return res.status(404).json({ ok:false, error:'Not found' });

    const r = buildRowArray(found.row);
    if (typeof firstName !== 'undefined') r[COL.firstName] = String(firstName).trim();
    if (typeof lastName  !== 'undefined') r[COL.lastName]  = String(lastName).trim();
    if (typeof phone     !== 'undefined') r[COL.phone]     = String(phone).trim();
    if (typeof password  !== 'undefined' && password !== '') r[COL.password] = String(password);
    await updateRow(found.sheetRow, r);

    return res.json({
      ok: true,
      profile: {
        employeeId: r[COL.employeeId], email: r[COL.email],
        firstName: r[COL.firstName] || '', lastName: r[COL.lastName] || '',
        phone: r[COL.phone] || '', active: !!toBoolean(r[COL.active]),
        createdAt: r[COL.createdAt] || ''
      }
    });
  } catch (err) {
    console.error('[employees/put:me]', err);
    return res.status(500).json({ ok:false, error:'Server error' });
  }
});

// ===================================================================
//                 PERSISTENT AVAILABILITY TEMPLATE
// ===================================================================

// GET /api/employees/availability/template?employeeId=E001
router.get('/availability/template', async (req, res) => {
  try {
    const employeeId = String(req.query.employeeId || '').trim();
    if (!employeeId) return res.status(400).json({ ok:false, error:'employeeId required' });

    const all = await readAllTemplateRows();
    const mine = all
      .map(x => x.row)
      .filter(r => (r[TCOL.employeeId] || '').toString().trim() === employeeId)
      .filter(r => DAY_KEYS.includes(String(r[TCOL.weekday] || '').toLowerCase()));

    const days = { mon:[], tue:[], wed:[], thu:[], fri:[], sat:[], sun:[] };
    for (const r of mine) {
      const k = String(r[TCOL.weekday]).toLowerCase();
      days[k].push({
        startTime: fmtTime(r[TCOL.start]),
        endTime:   fmtTime(r[TCOL.end]),
        slot:      parseInt(r[TCOL.slot] || '0', 10) || 0,
        notes:     String(r[TCOL.notes] || '')
      });
    }
    for (const k of DAY_KEYS) {
      days[k].sort((a,b) => (a.startTime || '').localeCompare(b.startTime || '') || (a.slot - b.slot));
    }

    return res.json({ ok:true, days });
  } catch (err) {
    console.error('[availability/template:get]', err);
    return res.status(500).json({ ok:false, error:'Server error' });
  }
});

// PUT /api/employees/availability/template
// Body: { employeeId, days: { mon:[{start,end}], tue:[...], ... } }
router.put('/availability/template', async (req, res) => {
  try {
    const { employeeId, days } = req.body || {};
    if (!employeeId || !days) return res.status(400).json({ ok:false, error:'employeeId and days required' });

    const toAppend = [];
    const updatedAt = isoNow();
    for (const k of DAY_KEYS) {
      const arr = Array.isArray(days[k]) ? days[k] : [];
      const sorted = arr
        .map(x => ({ start: String(x.start || x.startTime || '').slice(0,5), end: String(x.end || x.endTime || '').slice(0,5) }))
        .filter(x => x.start && x.end && x.start < x.end)
        .sort((a,b) => a.start.localeCompare(b.start));

      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].start < sorted[i-1].end) {
          return res.status(400).json({ ok:false, error:`Overlapping intervals on ${k}` });
        }
      }

      sorted.forEach((x, idx) => {
        toAppend.push([ employeeId, k, idx + 1, x.start, x.end, '', updatedAt ]);
      });
    }

    await clearTemplateForEmployee(employeeId);
    if (toAppend.length) await appendTemplateRows(toAppend);

    return res.json({ ok:true });
  } catch (err) {
    console.error('[availability/template:put]', err);
    return res.status(500).json({ ok:false, error:'Server error' });
  }
});

// ===================================================================
//                             BLACKOUTS
// ===================================================================

// GET /api/employees/availability/blackouts?employeeId=E001
router.get('/availability/blackouts', async (req, res) => {
  try {
    const employeeId = String(req.query.employeeId || '').trim();
    if (!employeeId) return res.status(400).json({ ok:false, error:'employeeId required' });

    const all = await readAllBlackouts();
    const dates = all
      .map(x => x.row)
      .filter(r => (r[BLCOL.employeeId] || '').toString().trim() === employeeId)
      .map(r => String(r[BLCOL.date] || ''))
      .filter(Boolean)
      .sort();

    return res.json({ ok:true, dates });
  } catch (err) {
    console.error('[blackouts:get]', err);
    return res.status(500).json({ ok:false, error:'Server error' });
  }
});

// PUT /api/employees/availability/blackouts
// Body: { employeeId, dates: ["YYYY-MM-DD", ...], note? }
router.put('/availability/blackouts', async (req, res) => {
  try {
    const { employeeId, dates, note } = req.body || {};
    if (!employeeId || !Array.isArray(dates)) return res.status(400).json({ ok:false, error:'employeeId and dates[] required' });

    await setBlackoutsForEmployee(employeeId, dates, note || '');
    return res.json({ ok:true, dates: dates.sort() });
  } catch (err) {
    console.error('[blackouts:put]', err);
    return res.status(500).json({ ok:false, error:'Server error' });
  }
});

module.exports = router;
