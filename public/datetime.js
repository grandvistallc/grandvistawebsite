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

  // Ensure navigation and button classes match page style
  if (prevBtn) prevBtn.className = "nav-btn";
  if (nextBtn) nextBtn.className = "nav-btn";
  if (continueBtn) continueBtn.className = "reserve-btn";

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
    if (!Number.isFinite(H) || !Number.isFinite(M)) return "";
    const ampm = H >= 12 ? "PM" : "AM";
    const h = ((H + 11) % 12) + 1;
    return `${h}:${String(M).padStart(2, "0")} ${ampm}`;
  }
  const timeToMinutes = (hhmm) => {
    const [h,m] = String(hhmm||"").split(":").map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h*60 + m : 0;
  };

  /* ---------- Toast ---------- */
  function ensureToastStyles() {
    if (document.getElementById("toastStyles")) return;
    const css = `
      .toast-bubble { position: fixed; top: 18px; left: 50%; transform: translateX(-50%);
      max-width: 680px; padding: 1rem 1.5rem; border-radius: 16px; box-shadow: 0 10px 24px rgba(0,0,0,.13);
        font-size: 1.05rem; line-height: 1.5; z-index: 9999; opacity: 0; transition: opacity .25s, transform .25s;
        color: #374151; background: #fff7ed; border: 1px solid #e2e8f0; font-family: 'Inter', 'Segoe UI', sans-serif; }
      .toast-bubble.error { background: #ffd0d0; color: #b91c1c; border-color: #fca5a5; }
      .toast-bubble.info { background: #dbeafe; color: #2563eb; border-color: #93c5fd; }
      .toast-bubble.show { opacity: 1; transform: translateX(-50%) translateY(0); }
      .toast-close { margin-left: 1rem; cursor: pointer; font-weight: 700; color: #64748b; font-size: 1.2rem; }
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
    div.addEventListener('click', close); setTimeout(close, ms);
  }

  /* ---------- State ---------- */
  const today = todayISO();
  let viewYear,
      viewMonth,
      selectedDate = null,
      activeTime   = null,
      availableDateSet = new Set();

  /* ---------- Calendar ---------- */
  function setMonthLabel(y, m1to12) {
    const d = new Date(y, m1to12 - 1, 1);
    monthYearEl.textContent = d.toLocaleString(undefined, { month: "long", year: "numeric" });
  }
  function renderCalendarGrid(y, m1to12) {
    calendarEl.innerHTML = "";
    const first = new Date(y, m1to12 - 1, 1);
    const last = new Date(y, m1to12, 0).getDate();
    const startDow = first.getDay(); // 0=Sun..6=Sat
    for (let i = 0; i < startDow; i++) {
  const blank = document.createElement("div"); blank.className = "calendar-day inactive"; blank.style.visibility = "hidden";
      calendarEl.appendChild(blank);
    }
    for (let d = 1; d <= last; d++) {
      const cell = document.createElement("div"); cell.className = "calendar-day"; cell.textContent = d;
      const iso = isoFor(y, m1to12, d);

      // Block past dates: enable only if in available set AND not before today
      const enabled = availableDateSet.has(iso) && iso >= today;

  if (!enabled) cell.classList.add("disabled");
  if (selectedDate === iso) cell.classList.add("selected");

      if (enabled) {
        cell.addEventListener("click", async () => {
          selectedDate = iso; activeTime = null;
          Array.from(calendarEl.querySelectorAll(".calendar-day")).forEach(c =>
            c.classList.toggle("selected", c === cell)
          );
          writeJSON(LS_APPT, { date: selectedDate, time: null });
          await refreshSlotsForDate(selectedDate);
        });
      }
      calendarEl.appendChild(cell);
    }
  }

  async function loadAvailableDates(y, m1to12) {
    const bust = `_=${Date.now()}`;
    // Try /api/available-dates, accept either {dates:[...]} or {days:[...]}
    let r = await fetch(`${API_BASE}/api/available-dates?year=${y}&month=${m1to12}&${bust}`);
    if (!r.ok && r.status !== 404) throw new Error(`available_dates_http_${r.status}`);
    if (r.status === 404) {
      // fallback
      r = await fetch(`${API_BASE}/api/availableDates?year=${y}&month=${m1to12}&${bust}`);
      if (!r.ok) throw new Error(`available_dates_http_${r.status}`);
    }
    const data = await r.json().catch(() => ({}));
    const arr = Array.isArray(data?.dates) ? data.dates
              : Array.isArray(data?.days)  ? data.days
              : [];
    availableDateSet = new Set(arr);
  }

  /* ---------- Slots ---------- */
  function clearSlots() { slotsGrid.innerHTML = ""; }
  function disableContinue() { continueBtn?.setAttribute("disabled","disabled"); }
  function enableContinue() { continueBtn?.removeAttribute("disabled"); }

  async function refreshSlotsForDate(dateISO) {
    clearSlots(); disableContinue();

    const bust = `_=${Date.now()}`;
    let r = await fetch(`${API_BASE}/api/availability?date=${encodeURIComponent(dateISO)}&${bust}`);
    if (!r.ok && r.status !== 404) throw new Error(`availability_http_${r.status}`);
    if (r.status === 404) {
      r = await fetch(`${API_BASE}/api/slots?date=${encodeURIComponent(dateISO)}&${bust}`);
      if (!r.ok) throw new Error(`availability_http_${r.status}`);
    }
    const data = await r.json().catch(() => ({}));
    const slots = Array.isArray(data?.slots) ? data.slots : [];

    // Render slots
    if (!Array.isArray(slots) || slots.length === 0) {
      const empty = document.createElement("div");
      empty.className = "no-slots";
      empty.textContent = "No times available for this date.";
      slotsGrid.appendChild(empty);
      return;
    }

    slots.forEach(slot => {
      const btn = document.createElement("div");
      btn.className = "slot-btn";
      
      // Handle different slot formats
      let displayText = "";
      if (typeof slot === "string") {
        // Try to parse as time (HH:MM or HHMM format)
        if (slot.includes(":")) {
          displayText = to12h(slot);
        } else if (/^\d{3,4}$/.test(slot)) {
          // Format like "0900" or "900" → convert to "09:00"
          const padded = slot.padStart(4, "0");
          const timeStr = `${padded.slice(0, 2)}:${padded.slice(2)}`;
          displayText = to12h(timeStr);
        } else {
          // Fallback: just display as-is
          displayText = String(slot);
        }
      } else if (typeof slot === "object" && slot !== null) {
        // If it's an object, try to extract time property and convert to 12h format
        if (slot.time) {
          displayText = to12h(String(slot.time));
        } else {
          displayText = String(slot);
        }
      } else {
        displayText = String(slot);
      }
      
      btn.textContent = displayText || "TBD";
      if (activeTime === slot) btn.classList.add("selected");
      btn.addEventListener("click", () => {
        activeTime = slot;
        Array.from(slotsGrid.children).forEach(b => b.classList.toggle("selected", b === btn));
        writeJSON(LS_APPT, { date: selectedDate, time: activeTime });
        continueBtn.disabled = false;
      });
      slotsGrid.appendChild(btn);
    });
    continueBtn.disabled = !activeTime;
  }

  /* ---------- Navigation ---------- */
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

  async function refreshMonth() {
    setMonthLabel(viewYear, viewMonth);
    await loadAvailableDates(viewYear, viewMonth);
    renderCalendarGrid(viewYear, viewMonth);

    if (!selectedDate ||
        !selectedDate.startsWith(`${viewYear}-${String(viewMonth).padStart(2,"0")}`) ||
        !availableDateSet.has(selectedDate) ||
        selectedDate < today) {
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
