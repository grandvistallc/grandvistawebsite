// public/datetime.js
// Server-driven month availability + slot list + flash bubble.
// Persists:
// - localStorage.appointmentSelection = { date, time }
// - localStorage.flashMsg = { type, text } (optional)

(() => {
  /* ---------- API BASE ---------- */
  const API_BASE = 'https://dashboard-299729627197.us-central1.run.app'.replace(/\/+$/,'');

  /* ---------- DOM ---------- */
  const calendarEl  = document.getElementById("calendar");
  const monthYearEl = document.getElementById("monthYear");
  const prevBtn     = document.getElementById("prevBtn");
  const nextBtn     = document.getElementById("nextBtn");
  const slotsGrid   = document.getElementById("slotsGrid");
  const continueBtn = document.getElementById("continueBtn");

  /* ---------- LocalStorage ---------- */
  const LS_APPT  = "appointmentSelection";
  const LS_FLASH = "flashMsg";

  /* ---------- Utils ---------- */
  const readJSON  = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
  const writeJSON = (k, v) => (v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)));

  function todayISO() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  }
  function isoFor(y, m1to12, d) {
    const m  = String(m1to12).padStart(2, "0");
    const dd = String(d).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }
  function to12h(hhmm) {
    const [H, M] = String(hhmm || "").split(":").map(Number);
    if (!Number.isFinite(H) || !Number.isFinite(M)) return hhmm || "";
    const ampm = H >= 12 ? "PM" : "AM";
    const h = ((H + 11) % 12) + 1;
    return `${h}:${String(M).padStart(2, "0")} ${ampm}`;
  }

  /* ---------- Toast ---------- */
  function ensureToastStyles() {
    if (document.getElementById("toastStyles")) return;
    const css = `
      .toast-bubble { position: fixed; top: 18px; left: 50%; transform: translateX(-50%);
        max-width: 680px; padding: 12px 16px; border-radius: 12px; box-shadow: 0 10px 24px rgba(0,0,0,.25);
        font-size: 14px; line-height: 1.35; z-index: 9999; opacity: 0; transition: opacity .25s, transform .25s;
        color: #111; background: #FFE9B3; border: 1px solid rgba(0,0,0,.08); }
      .toast-bubble.error { background: #ffd0d0; } .toast-bubble.info { background: #d7ecff; }
      .toast-bubble.show { opacity: 1; transform: translateX(-50%) translateY(0); }
      .toast-close { margin-left: 10px; cursor: pointer; font-weight: 700; color: #333; }
    `;
    const style = document.createElement('style'); style.id = 'toastStyles'; style.textContent = css; document.head.appendChild(style);
  }
  function showToast(message, type = 'warn', ms = 5200) {
    ensureToastStyles();
    const old = document.getElementById('toastBubble'); if (old) old.remove();
    const div = document.createElement('div');
    div.id = 'toastBubble';
    div.className = `toast-bubble ${type === 'error' ? 'error' : type === 'info' ? 'info' : ''}`;
    div.innerHTML = `<span>${message}</span><span class="toast-close" aria-label="Close">×</span>`;
    document.body.appendChild(div);
    requestAnimationFrame(() => div.classList.add('show'));
    const close = () => { div.classList.remove('show'); setTimeout(() => div.remove(), 250); };
    div.querySelector('.toast-close').addEventListener('click', close); setTimeout(close, ms);
  }

  /* ---------- State ---------- */
  const today = todayISO();
  let viewYear, viewMonth;
  let availableDateSet = new Set();
  let selectedDate = null; // YYYY-MM-DD
  let activeTime   = null; // "HH:MM" (24h)

  /* ---------- Buttons ---------- */
  function disableContinue() { if (continueBtn) continueBtn.disabled = true; }
  function enableContinue()  { if (continueBtn) continueBtn.disabled = false; }
  disableContinue();

  if (continueBtn) {
    continueBtn.addEventListener("click", () => {
      if (!selectedDate || !activeTime) return;
      writeJSON(LS_APPT, { date: selectedDate, time: activeTime });
      window.location.href = "/checkout";
    });
  }

  if (prevBtn) prevBtn.addEventListener("click", async () => {
    const d = new Date(viewYear, viewMonth - 2, 1);
    viewYear = d.getFullYear(); viewMonth = d.getMonth() + 1;
    await refreshMonth();
  });
  if (nextBtn) nextBtn.addEventListener("click", async () => {
    const d = new Date(viewYear, viewMonth, 1);
    viewYear = d.getFullYear(); viewMonth = d.getMonth() + 1;
    await refreshMonth();
  });

  /* ---------- Flash-from-redirect ---------- */
  (function showFlashIfAny() {
    const urlMsg = new URLSearchParams(window.location.search).get('msg');
    let f = readJSON(LS_FLASH);
    if (urlMsg) { showToast(urlMsg, 'warn'); localStorage.removeItem(LS_FLASH); return; }
    if (f?.text) { showToast(f.text, f.type || 'info'); localStorage.removeItem(LS_FLASH); }
  })();

  /* ---------- Slots ---------- */
  function clearSlots() { slotsGrid.innerHTML = ""; }
  function renderSlots(slots) {
    clearSlots();
    if (!slots || !slots.length) {
      const p = document.createElement("p"); p.className = "muted"; p.textContent = "No times available for this date.";
      slotsGrid.appendChild(p); return;
    }
    slots.forEach(s => {
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "slot-btn";
      btn.textContent = to12h(s.time); btn.dataset.time = s.time;
      if (!s.capacity || s.capacity <= 0) { btn.disabled = true; btn.classList.add("full"); }
      if (activeTime && s.time === activeTime) btn.classList.add("selected");
      btn.addEventListener("click", () => onSlotClick(s.time));
      slotsGrid.appendChild(btn);
    });
  }
  function markActiveTime(hh) {
    Array.from(slotsGrid.querySelectorAll(".slot-btn")).forEach(b => b.classList.toggle("selected", b.dataset.time === hh));
  }
  async function onSlotClick(timeHHMM) {
    if (!selectedDate) return;
    activeTime = timeHHMM; markActiveTime(timeHHMM);
    writeJSON(LS_APPT, { date: selectedDate, time: activeTime }); enableContinue();
  }

  async function refreshSlotsForDate(dateISO) {
    clearSlots();
    try {
      // Try primary route, then fallback
      let r = await fetch(`${API_BASE}/api/availability?date=${encodeURIComponent(dateISO)}`);
      if (r.status === 404) r = await fetch(`${API_BASE}/api/day-slots?date=${encodeURIComponent(dateISO)}`);
      if (!r.ok) throw new Error(`slots_http_${r.status}`);
      const data = await r.json();
      const slots = Array.isArray(data?.slots) ? data.slots : (Array.isArray(data) ? data : []);
      renderSlots(slots);
      if (activeTime && slots.some(s => s.time === activeTime)) { markActiveTime(activeTime); enableContinue(); }
      else { activeTime = null; disableContinue(); }
    } catch (e) {
      console.error("availability error", e);
      showToast("Times failed to load. Please try another date.", "error");
      disableContinue(); renderSlots([]);
    }
  }

  /* ---------- Calendar ---------- */
  function setMonthLabel(y, m1to12) {
    const date = new Date(y, m1to12 - 1, 1);
    monthYearEl.textContent = date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }
  function renderCalendarGrid(y, m1to12) {
    calendarEl.innerHTML = "";
    const first = new Date(y, m1to12 - 1, 1);
    const last = new Date(y, m1to12, 0).getDate();
    const startDow = first.getDay(); // 0=Sun..6=Sat
    for (let i = 0; i < startDow; i++) {
      const blank = document.createElement("div"); blank.className = "calendar-cell inactive"; blank.style.visibility = "hidden";
      calendarEl.appendChild(blank);
    }
    for (let d = 1; d <= last; d++) {
      const cell = document.createElement("div"); cell.className = "calendar-cell"; cell.textContent = d;
      const iso = isoFor(y, m1to12, d);
      const enabled = availableDateSet.has(iso);
      if (!enabled) cell.classList.add("inactive");
      if (iso === selectedDate) cell.classList.add("selected");
      if (enabled) {
        cell.addEventListener("click", async () => {
          selectedDate = iso; activeTime = null;
          Array.from(calendarEl.querySelectorAll(".calendar-cell")).forEach(c => c.classList.toggle("selected", c === cell));
          writeJSON(LS_APPT, { date: selectedDate, time: null });
          await refreshSlotsForDate(selectedDate);
        });
      }
      calendarEl.appendChild(cell);
    }
  }

  async function loadAvailableDates(y, m1to12) {
    // Try /api/available-dates, accept either {dates:[...]} or {days:[...]}
    let r = await fetch(`${API_BASE}/api/available-dates?year=${y}&month=${m1to12}`);
    if (!r.ok && r.status !== 404) throw new Error(`available_dates_http_${r.status}`);
    if (r.status === 404) {
      // fallback route names if your backend uses camelCase or different path
      r = await fetch(`${API_BASE}/api/availableDates?year=${y}&month=${m1to12}`);
      if (!r.ok) throw new Error(`available_dates_http_${r.status}`);
    }
    const data = await r.json().catch(() => ({}));
    const arr = Array.isArray(data?.dates) ? data.dates
              : Array.isArray(data?.days)  ? data.days
              : [];
    availableDateSet = new Set(arr);
  }

  async function refreshMonth() {
    setMonthLabel(viewYear, viewMonth);
    await loadAvailableDates(viewYear, viewMonth);
    renderCalendarGrid(viewYear, viewMonth);

    if (!selectedDate ||
        !selectedDate.startsWith(`${viewYear}-${String(viewMonth).padStart(2,"0")}`) ||
        !availableDateSet.has(selectedDate)) {
      selectedDate = null; activeTime = null; clearSlots(); disableContinue();
    } else {
      await refreshSlotsForDate(selectedDate);
    }
  }

  /* ---------- Init ---------- */
  (function init() {
    const prev = readJSON(LS_APPT);
    const baseDate = prev?.date && prev.date >= today ? prev.date : null;
    const base = baseDate ? new Date(`${baseDate}T00:00:00`) : new Date();
    viewYear = base.getFullYear(); viewMonth = base.getMonth() + 1; selectedDate = baseDate;
    refreshMonth().catch(err => { console.error(err); showToast("Calendar failed to load.", "error"); });
  })();
})();
