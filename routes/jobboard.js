// routes/jobboard.js
// GrandVista Job Board & Auto-Routing (Google Sheets backend)

const express = require("express");
const router = express.Router();
const { google } = require("googleapis");

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_JOBS = process.env.SHEET_JOBS || "Bookings";
const SHEET_AVAIL = process.env.SHEET_AVAIL || "Availability";

/* ==================== AUTH ==================== */
async function getSheetsClient() {
  let auth;
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    // local dev with credentials.json
    auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
  } else {
    // production env variables
    auth = new google.auth.JWT({
      email: process.env.GOOGLE_CLIENT_EMAIL,
      key: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
  }
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

/* ==================== UTILS ==================== */
function safeParse(json, fallback = []) {
  try { return JSON.parse(json || "[]"); } catch { return fallback; }
}
function toMonthKey(isoDate) {
  const d = new Date(`${isoDate}T00:00:00`);
  if (isNaN(d)) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function parseSheetTimeToHHMM(cell) {
  const s = String(cell || "").trim().toUpperCase();
  if (!s) return null;
  let m = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (m) {
    let h = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const ap = m[3];
    if (ap === "PM" && h !== 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }
  m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) return `${String(parseInt(m[1], 10)).padStart(2, "0")}:${String(parseInt(m[2], 10)).padStart(2, "0")}`;
  return null;
}
function hoursUntil(dateISO, timeCell) {
  const hhmm = parseSheetTimeToHHMM(timeCell) || "00:00";
  const tgt = new Date(`${dateISO}T${hhmm}:00`);
  const now = new Date();
  return (tgt - now) / 36e5;
}
function relevanceScore(dateISO, timeCell) {
  const hhmm = parseSheetTimeToHHMM(timeCell) || "00:00";
  return new Date(`${dateISO}T${hhmm}:00`).getTime();
}
function normalizeJob(row) {
  return {
    id: row[0] || "",
    serviceDate: row[1] || "",
    customerName: row[2] || "",
    service: row[3] || "",
    size: row[4] || "",
    notes: row[5] || "",
    price: Number(row[6] || 0),
    serviceTime: row[7] || "",
    endTime: row[8] || "",
    heardFrom: row[9] || "",
    email: row[10] || "",
    phone: row[11] || "",
    address: row[12] || "",
    status: row[13] || "open",
    assignedWorkerIds: row[14] || "[]",   // JSON string
    // if you later add a RequiredWorkers column to the sheet, read it here.
    requiredWorkers: 2,
    monthKey: toMonthKey(row[1] || ""),
    relevanceScore: relevanceScore(row[1] || "", row[7] || "")
  };
}
async function readSheetRange(sheets, sheetName, rangeA1) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!${rangeA1}`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  return res.data.values || [];
}
async function updateStatusAndCrew(sheets, rowIndex1, status, crewArr) {
  const range = `${SHEET_JOBS}!N${rowIndex1}:O${rowIndex1}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[status, JSON.stringify(crewArr || [])]] },
  });
}

/* ==================== LIST JOBS HANDLER (BOARD) ==================== */
async function listJobsHandler(req, res) {
  try {
    const { sort = "relevance", month } = req.query;
    const sheets = await getSheetsClient();
    const rows = await readSheetRange(sheets, SHEET_JOBS, "A2:O");

    const jobs = rows.map(normalizeJob).filter(j => {
      const hrs = hoursUntil(j.serviceDate, j.serviceTime);
      const assigned = safeParse(j.assignedWorkerIds);
      if (hrs < 48) return false;                       // board: hide near-term
      if (j.status === "filled") return false;          // board: hide filled
      if (assigned.length >= (j.requiredWorkers || 2)) return false; // board: hide full
      if (month && j.monthKey !== month) return false;
      return true;
    });

    jobs.sort((a, b) => {
      if (sort === "date") {
        return new Date(`${a.serviceDate}T${parseSheetTimeToHHMM(a.serviceTime) || "00:00"}:00`)
          - new Date(`${b.serviceDate}T${parseSheetTimeToHHMM(b.serviceTime) || "00:00"}:00`);
      } else {
        return a.relevanceScore - b.relevanceScore;
      }
    });

    res.json({ ok: true, jobs });
  } catch (e) {
    console.error("list jobs error", e);
    res.status(500).json({ ok: false, error: "list_failed" });
  }
}

/* ==================== ROUTES ==================== */
router.get("/", listJobsHandler);
router.get("/board", listJobsHandler);

/* ------- CLAIM ------- */
router.post("/:id/claim", async (req, res) => {
  const jobId = req.params.id;
  const { workerId } = req.body;
  if (!workerId) return res.status(400).json({ ok: false, error: "missing_workerId" });

  try {
    const sheets = await getSheetsClient();
    const rows = await readSheetRange(sheets, SHEET_JOBS, "A2:O");
    const rowIndex = rows.findIndex(r => (r[0] || "") === jobId);
    if (rowIndex === -1) return res.status(404).json({ ok: false, error: "job_not_found" });

    const row = rows[rowIndex];
    const currentAssigned = safeParse(row[14]);
    const requiredWorkers = row[15] ? Number(row[15]) : 2;

    if (!currentAssigned.includes(workerId)) currentAssigned.push(workerId);

    const status = currentAssigned.length >= requiredWorkers ? "filled" : "open";
    await updateStatusAndCrew(sheets, rowIndex + 2, status, currentAssigned);

    res.json({ ok: true, assignedWorkerIds: currentAssigned, status });
  } catch (e) {
    console.error("claim error", e);
    res.status(500).json({ ok: false, error: "claim_failed" });
  }
});

/* ------- UNCLAIM ------- */
router.post("/:id/unclaim", async (req, res) => {
  const jobId = req.params.id;
  const { workerId } = req.body;
  if (!workerId) return res.status(400).json({ ok: false, error: "missing_workerId" });

  try {
    const sheets = await getSheetsClient();
    const rows = await readSheetRange(sheets, SHEET_JOBS, "A2:O");
    const rowIndex = rows.findIndex(r => (r[0] || "") === jobId);
    if (rowIndex === -1) return res.status(404).json({ ok: false, error: "job_not_found" });

    const row = rows[rowIndex];
    let currentAssigned = safeParse(row[14]);
    const requiredWorkers = row[15] ? Number(row[15]) : 2;

    currentAssigned = currentAssigned.filter(id => id !== workerId);

    const status = currentAssigned.length >= requiredWorkers ? "filled" : "open";
    await updateStatusAndCrew(sheets, rowIndex + 2, status, currentAssigned);

    res.json({ ok: true, assignedWorkerIds: currentAssigned, status });
  } catch (e) {
    console.error("unclaim error", e);
    res.status(500).json({ ok: false, error: "unclaim_failed" });
  }
});

/* ------- MINE (used by My Jobs page) ------- */
router.get("/mine", async (req, res) => {
  try {
    const workerId = String(req.query.workerId || "").trim();
    if (!workerId) return res.status(400).json({ ok: false, error: "missing_workerId" });

    const sheets = await getSheetsClient();
    const rows = await readSheetRange(sheets, SHEET_JOBS, "A2:O");

    // Include ALL jobs claimed by this worker (even if within 48h or filled)
    const jobs = rows
      .map(normalizeJob)
      .filter(j => safeParse(j.assignedWorkerIds).includes(workerId))
      // Optionally hide cancelled if you ever add that:
      .filter(j => j.status !== "cancelled")
      .sort((a, b) => a.relevanceScore - b.relevanceScore);

    return res.json({ ok: true, jobs });
  } catch (e) {
    console.error("mine error", e);
    return res.status(500).json({ ok: false, error: "mine_failed" });
  }
});

/* (optional) complete job endpoint used by myjobs.js if you wire it up */
router.post("/:id/complete", async (req, res) => {
  try {
    const jobId = req.params.id;
    const sheets = await getSheetsClient();
    const rows = await readSheetRange(sheets, SHEET_JOBS, "A2:O");
    const rowIndex = rows.findIndex(r => (r[0] || "") === jobId);
    if (rowIndex === -1) return res.status(404).json({ ok: false, error: "job_not_found" });

    // set status to "completed" (col N), keep crew (col O) unchanged
    const row = rows[rowIndex];
    const crew = safeParse(row[14]);
    await updateStatusAndCrew(sheets, rowIndex + 2, "completed", crew);

    return res.json({ ok: true });
  } catch (e) {
    console.error("complete error", e);
    return res.status(500).json({ ok: false, error: "complete_failed" });
  }
});

module.exports = router;
