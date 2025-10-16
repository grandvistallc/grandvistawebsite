/* ===========================
   DateTime • Premium Dark + Gold (Mobile-first)
   =========================== */

/* ---- Base ---- */
* { box-sizing: border-box; }
:root {
  /* Calendar cell size scales with viewport, but capped */
  --cell: clamp(34px, 9vw, 46px);
  --gap: 10px;
}

body {
  background-color: #1f1f1f;
  color: #fff;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  margin: 0;
  padding: 12px; /* reduced on mobile */
  display: flex;
  justify-content: center;
  align-items: flex-start;
  min-height: 100vh;

  /* soften heavy effects on mobile to avoid jank */
  background-image:
    radial-gradient(900px 400px at 20% -10%, rgba(245,179,1,0.10), transparent 60%),
    radial-gradient(800px 360px at 110% 0%, rgba(255,152,0,0.08), transparent 65%),
    linear-gradient(#1f1f1f, #1f1f1f);
  background-attachment: scroll;
}

.outer-container {
  background-color: #2a2a2a;
  padding: 16px;          /* tighter on mobile */
  border-radius: 14px;
  box-shadow: 0 4px 22px rgba(0,0,0,0.45);
  max-width: 800px;
  margin: 20px auto;
  width: 100%;
}

/* ---- Header ---- */
.headline {
  font-size: 1.35rem;
  font-weight: 700;
  margin-bottom: 6px;
  text-align: center;
}
.subline {
  font-size: 0.92rem;
  color: #ccc;
  text-align: center;
}

/* ---- Month Navigation ---- */
.calendar-nav {
  display: flex;
  justify-content: center;
  align-items: center;
  margin: 14px 0;
  gap: 8px;
}

.nav-btn {
  background-color: #2a2a2a;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 0.95rem;
  transition: background-color 0.2s ease, box-shadow 0.2s ease;
  touch-action: manipulation;
}
.nav-btn:hover { background-color: #3a3a3a; box-shadow: 0 0 8px rgba(245,179,1,0.4); }

.month-year {
  font-weight: bold;
  font-size: 1rem;
}

/* ---- Calendar ---- */
.calendar {
  background-color: #222;
  border-radius: 12px;
  padding: 12px;                               /* tighter */
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr)); /* keep 7 cols; responsive widths */
  gap: var(--gap);
  justify-items: center;
}

.calendar-cell {
  width: var(--cell);
  height: var(--cell);
  background-color: #ffffff;
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
  color: #000000;
  font-weight: 700;
  font-size: clamp(12px, 3.5vw, 14px);
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease;
  user-select: none;
  touch-action: manipulation;
}

.calendar-cell:hover {
  transform: scale(1.05);
  box-shadow: 0 0 10px rgba(245, 179, 1, 0.6);
}

.calendar-cell.inactive {
  background-color: #333;
  opacity: 0.55;
  cursor: default;
}

.calendar-cell.selected {
  background-color: #f5b301;
  color: #000000;
}

/* ---- Time Slots ---- */
.timeslots h2 {
  text-align: left;
  font-size: 1.05rem;
  margin-top: 16px;
  margin-bottom: 8px;
}

.slots-grid {
  display: grid;                          /* better wrapping than flex */
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 10px;
  margin-top: 10px;
}

.slot-btn {
  background-color: #2ecc71;
  color: #ffffff;
  padding: 10px 14px;
  border-radius: 20px;
  font-size: 0.95rem;
  cursor: pointer;
  border: none;
  min-height: 40px;                       /* touch target */
  transition: background-color 0.2s ease, transform 0.1s ease, box-shadow 0.2s ease;
  touch-action: manipulation;
  width: 100%;
  text-align: center;
}
.slot-btn:hover { background-color: #27ae60; box-shadow: 0 0 8px rgba(245,179,1,0.4); }
.slot-btn.selected { outline: 2px solid #f5b301; transform: scale(1.02); }

.slot-btn.limited { background-color: #f39c12; }
.slot-btn.full { background-color: #e74c3c; cursor: not-allowed; opacity: 0.8; }

/* ---- Reserve Button ---- */
.reserve-btn {
  display: block;
  margin: 18px auto 0;
  padding: 12px 20px;
  font-size: 1rem;
  background: linear-gradient(90deg, #f5b301, #ff9800);
  border: none;
  color: black;
  font-weight: bold;
  border-radius: 10px;
  cursor: pointer;
  width: 100%;                     /* full-width on mobile */
  max-width: 520px;                /* but not too wide on large screens */
  transition: transform 0.2s ease, box-shadow 0.3s ease;
  touch-action: manipulation;
}
.reserve-btn:hover { transform: scale(1.02); box-shadow: 0 0 14px rgba(245, 179, 1, 0.6); }

/* ===========================
   Responsive Tweaks
   =========================== */
@media (min-width: 768px) {
  body { padding: 20px; background-attachment: fixed; }
  .outer-container { padding: 24px; margin: 40px auto; }
  .headline { font-size: 1.6rem; }
  .month-year { font-size: 1.05rem; }
  .reserve-btn { width: auto; padding: 12px 40px; }
}

@media (max-width: 420px) {
  :root { --cell: clamp(30px, 9vw, 40px); --gap: 8px; }
  .outer-container { padding: 14px; }
  .calendar { padding: 10px; }
  .slots-grid { grid-template-columns: 1fr 1fr; } /* tight phones: 2 per row */
}

/* Optional: keep CTA visible when content scrolls on small screens */
@supports (position: sticky) {
  .reserve-btn.sticky {
    position: sticky;
    bottom: 12px;
    z-index: 5;
  }
}
