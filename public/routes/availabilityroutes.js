// availabilityRoutes.js
require("dotenv").config();
const express = require("express");
const { google } = require("googleapis");

const router = express.Router();

/* ========= ENV / CONFIG ========= */
const SPREADSHEET_ID = process.env.SHEETS_SPREADSHEET_ID || process.env.GOOGLE_SHEET_ID;
const AVAIL_TAB = process.env.SHEETS_AVAIL_TAB || "Availability";
const BOOKINGS_TAB = process.env.SHEETS_BOOKINGS_TAB || "Bookings";

// Bookings layout you showed: Date in column B, Time in column H (12-hour like "12:30 PM")
const BOOKINGS_DATE_COL_INDEX = 1; // B = index 1 (0-based)
const BOOKINGS_TIME_COL_INDEX = 7; // H = index 7 (0-based)

/* ========= GOOGLE AUTH ========= */
async function getSheets() {
  if (!SPREADSHEET_ID) {
    throw new Error("Missing SHEETS_SPREADSHEET_ID (or GOOGLE_SHEET_ID) in .env");
  }
  const auth = new google.auth.GoogleAuth({
    credentials: {
      type: "service_account",
      project_id: process.env.GOOGLE_PROJECT_ID,
      private_key: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth: await auth.getClient() });
}

/* ========= TIME HELPERS ========= */
function pad2(n) {
  return String(n).padStart(2, "0");
}
function toHHMM(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${pad2(h)}:${pad2(m)}`;
}
function parse24hToMins(str) {
  // Accept "9:00", "09:00", "17:30"
  const [h, m] = String(str).trim().split(":").map(Number);
  if (Number.isFinite(h) && Number.isFinite(m)) return h * 60 + m;
  return null;
}
function parse12hToMins(str) {
  // Accept "12:30 PM" etc
  const s = String(str).trim().toUpperCase();
  const match = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (!match) return null;
  let [_, hh, mm, ap] = match;
  let h = Number(hh);
  const m = Number(mm);
  if (ap === "PM" && h !== 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return h * 60 + m;
}
/** Try to parse a cell that might be "09:00", "9:00", or "12:30 PM". */
function parseTimeCell(cell) {
  if (cell == null || cell === "") return null;
  // If Google returned a number (rare here), treat as days since 1899; convert fractional to minutes
  if (typeof cell === "number") {
    const dayFraction = cell % 1;
    const mins = Math.round(dayFraction * 24 * 60);
    return mins;
  }
  return parse24hToMins(cell) ?? parse12hToMins(cell);
}

/* ========= SHEETS IO ========= */
async function readAvailabilityRows(dateStr) {
  const sheets = await getSheets();
  const range = `${AVAIL_TAB}!A:I`; // EmployeeId | Employee | Date | Start | End | SlotMins | Capacity | Active | Notes
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range,
  });
  const rows = data.values || [];
  const header = rows[0] || [];
  const body = rows.slice(1);

  const idx = {
    employeeId: header.findIndex((h) => /^employeeid$/i.test(h)),
    employee: header.findIndex((h) => /^employee$/i.test(h)),
    date: header.findIndex((h) => /^date$/i.test(h)),
    start: header.findIndex((h) => /^start$/i.test(h)),
    end: header.findIndex((h) => /^end$/i.test(h)),
    slotMins: header.findIndex((h) => /^slotmins$/i.test(h)),
    capacity: header.findIndex((h) => /^capacity$/i.test(h)),
    active: header.findIndex((h) => /^active$/i.test(h)),
  };

  // Normalize to objects; filter by date + active
  const out = [];
  for (const r of body) {
    const activeVal = (r[idx.active] ?? "").toString().trim().toUpperCase();
    const rowDate = (r[idx.date] ?? "").toString().trim();
    if (!rowDate || rowDate !== dateStr) continue;
    if (activeVal !== "TRUE" && activeVal !== "1") continue;

    const startMins = parseTimeCell(r[idx.start]);
    const endMins = parseTimeCell(r[idx.end]);
    if (startMins == null || endMins == null || endMins <= startMins) continue;

    const slotMins = Number(r[idx.slotMins]) || 30;
    const capacity = Math.max(0, Number(r[idx.capacity]) || 1);

    out.push({
      employeeId: (r[idx.employeeId] || "").toString().trim(),
      employee: (r[idx.employee] || "").toString().trim(),
      date: dateStr,
      startMins,
      endMins,
      slotMins,
      capacity,
    });
  }
  return out;
}

async function readBookedTimes(dateStr) {
  const sheets = await getSheets();
  const range = `${BOOKINGS_TAB}!A:Z`; // we only read columns we need
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range,
  });
  const rows = data.values || [];
  const body = rows.slice(1); // assume row 1 is header

  const bookedSet = new Set();
  for (const r of body) {
    const d = (r[BOOKINGS_DATE_COL_INDEX] ?? "").toString().trim();
    if (!d || d !== dateStr) continue;
    const tCell = r[BOOKINGS_TIME_COL_INDEX];
    const tMins =
      parse12hToMins(tCell) ?? parse24hToMins(tCell) ?? parseTimeCell(tCell);
    if (tMins == null) continue;
    bookedSet.add(toHHMM(tMins)); // store in HH:MM for direct comparison
  }
  return bookedSet;
}

/* ========= CORE: SLOT GENERATION ========= */
function expandSlotsFromWindow(startMins, endMins, slotMins) {
  const slots = [];
  for (let m = startMins; m + slotMins <= endMins; m += slotMins) {
    slots.push({ start: toHHMM(m), end: toHHMM(m + slotMins) });
  }
  return slots;
}

/* ========= API: GET /api/availability =========
   Query:
     - date (YYYY-MM-DD)  [required]
     - employeeId (optional; if omitted: union across employees)
     - slotMins (optional override; else use row SlotMins)
*/
router.get("/availability", async (req, res) => {
  try {
    const dateStr = (req.query.date || "").trim();
    if (!dateStr) {
      return res.status(400).json({ error: "Missing ?date=YYYY-MM-DD" });
    }
    const employeeIdFilter = (req.query.employeeId || "").trim();
    const slotMinsOverride = Number(req.query.slotMins) || null;

    // 1) Read availability rows for date
    const windows = await readAvailabilityRows(dateStr);

    // Optionally filter by employeeId
    const filteredWindows = employeeIdFilter
      ? windows.filter((w) => w.employeeId === employeeIdFilter)
      : windows;

    // If no windows, tell the client clearly (no fallback)
    if (filteredWindows.length === 0) {
      return res.json({
        date: dateStr,
        employeeId: employeeIdFilter || null,
        slots: [],
        reason: "no-availability-rows",
      });
    }

    // 2) Read booked times for that date (global; your current Bookings sheet has no EmployeeId)
    const bookedTimes = await readBookedTimes(dateStr);

    // 3) Generate slots per window, subtract booked, enforce capacity=1
    // NOTE: Your current Bookings sheet doesn’t track capacity or employee.
    // We therefore block a slot if it appears in Bookings at that time.
    const slots = [];
    for (const w of filteredWindows) {
      const slotSize = slotMinsOverride || w.slotMins || 30;
      const raw = expandSlotsFromWindow(w.startMins, w.endMins, slotSize);
      for (const s of raw) {
        const taken = bookedTimes.has(s.start);
        if (!taken) {
          slots.push({
            start: s.start,
            end: s.end,
            employeeId: w.employeeId,
            employee: w.employee,
          });
        }
      }
    }

    // De-dup union (if multiple windows give same start)
    const uniqKey = new Set();
    const deduped = [];
    for (const s of slots) {
      const key = `${s.start}|${s.employeeId || ""}`;
      if (uniqKey.has(key)) continue;
      uniqKey.add(key);
      deduped.push(s);
    }

    return res.json({
      date: dateStr,
      employeeId: employeeIdFilter || null,
      slotMins: slotMinsOverride || null,
      slots: deduped.sort((a, b) => (a.start < b.start ? -1 : 1)),
    });
  } catch (err) {
    console.error("GET /api/availability error:", err);
    return res.status(500).json({ error: "availability_failed", detail: err.message });
  }
});

module.exports = router;
