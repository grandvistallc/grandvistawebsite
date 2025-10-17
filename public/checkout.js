// ====== HELPERS ======
const $ = (s) => document.querySelector(s);
function fmt(n) {
  return '$' + (Number(n || 0)).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}
function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function debounce(fn, ms = 400) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
function valToText(v) {
  if (v == null) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') {
    if (v.level) return String(v.level).charAt(0).toUpperCase() + String(v.level).slice(1);
    if (v.name)  return v.name;
    if (v.label) return v.label;
    return JSON.stringify(v);
  }
  return String(v);
}

// ====== BACKEND BASE (fix for 503) ======
const API_BASE = 'https://dashboard-299729627197.us-central1.run.app'.replace(/\/+$/,'');

// ====== LOAD SELECTIONS ======
function loadSelections() {
  let selection = null, appointment = null;
  try { selection = JSON.parse(localStorage.getItem('bookingSelection') || 'null'); } catch {}
  try { appointment = JSON.parse(localStorage.getItem('appointmentSelection') || 'null'); } catch {}
  
  // DEBUG: Log all localStorage keys
  console.log('=== ALL LOCALSTORAGE ===');
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const value = localStorage.getItem(key);
    console.log(`${key}:`, value);
  }
  console.log('=======================');
  
  return { selection, appointment };
}

// ====== SUMMARY ======
function renderSummary() {
  const { selection, appointment } = loadSelections();

  console.log('DEBUG renderSummary - selection:', JSON.stringify(selection, null, 2));
  console.log('DEBUG renderSummary - appointment:', JSON.stringify(appointment, null, 2));

  if (selection) {
    const packageName = selection.packageName || '—';
    const sizeLabel = selection.sizeLabel || '—';
    console.log('Setting package to:', packageName);
    console.log('Setting size to:', sizeLabel);
    
    $('#sumPackage').textContent = packageName;
    $('#sumSize').textContent = sizeLabel;

    const hair  = selection.hair?.level  ?? selection.petHair ?? selection.hair ?? selection.petHairLevel;
    const stain = selection.stain?.level ?? selection.staining ?? selection.stainLevel;
    const odor  = selection.odor?.level  ?? selection.deepOdor ?? selection.odorLevel;

    console.log('Hair:', hair, 'Stain:', stain, 'Odor:', odor);
    
    $('#sumHair').textContent  = valToText(hair);
    $('#sumStain').textContent = valToText(stain);
    $('#sumOdor').textContent  = valToText(odor);

    let addonsText = '—';
    if (Array.isArray(selection.addons) && selection.addons.length) {
      addonsText = selection.addons
        .map(a => (a && (a.name || a.label)) || valToText(a))
        .join(', ');
    }
    $('#sumAddons').textContent = addonsText;
    console.log('Addons:', addonsText);

    if (selection.subtotal != null && !Number.isNaN(Number(selection.subtotal))) {
      window.__checkoutSubtotal = Number(selection.subtotal);
      console.log('✓ Setting window.__checkoutSubtotal =', window.__checkoutSubtotal);
    } else {
      console.log('✗ ERROR: subtotal not found in selection. selection.subtotal =', selection.subtotal);
      window.__checkoutSubtotal = 0;
    }
  } else {
    console.log('✗ ERROR: No selection found in localStorage. Checkout cannot proceed!');
    $('#sumPackage').textContent = '—';
    $('#sumSize').textContent    = '—';
    $('#sumHair').textContent    = '—';
    $('#sumStain').textContent   = '—';
    $('#sumOdor').textContent    = '—';
    $('#sumAddons').textContent  = '—';
  }

  if (appointment) {
    const d = appointment.date || appointment.dateISO || '';
    let t = appointment.time || appointment.timeLabel || '';
    
    // Handle case where time is an object with {time: "HH:MM", ...}
    if (typeof t === 'object' && t.time) {
      t = t.time;
    }
    
    const apptText = (d && t) ? `${d} at ${t}` : (d || t || '—');
    $('#sumAppt').textContent = apptText;
    console.log('Appointment:', apptText);
  } else {
    $('#sumAppt').textContent = '—';
    console.log('⚠ No appointment found');
  }
}

// ====== PRICING ======
function syncSubtotal() {
  const stored = Number(window.__checkoutSubtotal || 0);
  console.log('DEBUG syncSubtotal: window.__checkoutSubtotal =', window.__checkoutSubtotal, 'stored =', stored);
  if (Number.isFinite(stored) && stored > 0) {
    $('#sumSubtotal').textContent = fmt(stored);
  } else {
    console.log('DEBUG: Subtotal is 0 or not a valid number');
    $('#sumSubtotal').textContent = fmt(0);
  }
}
function buildAddressFromInputs() {
  const street = $('#street')?.value?.trim() || '';
  const city   = $('#city')?.value?.trim() || '';
  const state  = $('#state')?.value?.trim() || '';
  const zip    = $('#zip')?.value?.trim() || '';
  return [street, city, state, zip].filter(Boolean).join(', ');
}
async function estimateFromServer() {
  const subtotal = toNumber(window.__checkoutSubtotal || 0);
  const address  = buildAddressFromInputs();
  const zip      = $('#zip')?.value?.trim() || '';

  if (!address && !zip) return false;

  try {
    const res = await fetch(`${API_BASE}/api/estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // public endpoint → no credentials needed
      body: JSON.stringify({ address, zip, subtotal })
    });
    if (!res.ok) throw new Error(`estimate failed ${res.status}`);

    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      const txt = await res.text();
      console.warn('Non-JSON from /api/estimate:', txt.slice(0, 200));
      throw new Error('estimate non-json');
    }

    const data = await res.json();
    $('#sumMileageFee').textContent = fmt(data.mileageFee || 0);
    $('#sumTax').textContent        = fmt(data.taxAmount  || 0);
    $('#sumTotal').textContent      = fmt(
      data.total || (subtotal + (data.mileageFee || 0) + (data.taxAmount || 0))
    );
    window.__cachedTax = toNumber(data.taxAmount || 0);
    return true;
  } catch (e) {
    console.warn('Server estimate failed:', e.message);
    return false;
  }
}
const debouncedRecalc = debounce(async () => { await estimateFromServer(); }, 500);

// ====== SUBMIT ======
async function handleSubmit(e) {
  e.preventDefault();
  const name  = $('#customerName').value.trim();
  const phone = $('#phone').value.trim();
  if (!name || !phone) {
    $('#errorMsg').classList.remove('hidden');
    return;
  }
  $('#errorMsg').classList.add('hidden');

  await estimateFromServer();

  const { selection, appointment } = loadSelections();

  const payload = {
    selection,
    appointment: {
      date: appointment?.date || appointment?.dateISO || "",
      time: appointment?.time || appointment?.timeLabel || "",
      tz:   appointment?.tz   || Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'
      // Optional: endTime if you calculate duration client-side
      // endTime: "16:30"
    },
    customer: {
      name,
      phone,
      email:  $('#email').value.trim(),
      address: {
        street: $('#street').value.trim(),
        city:   $('#city').value.trim(),
        state:  $('#state').value.trim(),
        zip:    $('#zip').value.trim(),
      },
      heardFrom: $('#heardFrom').value || '',
      notes:     $('#notes').value || '',
    },
    pricing: {
      subtotal:   toNumber(window.__checkoutSubtotal || 0),
      mileageFee: toNumber($('#sumMileageFee').textContent.replace(/[^0-9.]/g, '')),
      tax:        toNumber($('#sumTax').textContent.replace(/[^0-9.]/g, '')),
      total:      toNumber($('#sumTotal').textContent.replace(/[^0-9.]/g, '')),
    }
  };

  try {
    const res = await fetch(`${API_BASE}/api/confirm-booking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // public endpoint → no credentials needed
      body: JSON.stringify(payload)
    });

    // ---- Overlap handling: redirect back with bubble ----
    let overlapMsg = null;

    if (res.status === 409) {
      const j = await res.json().catch(() => ({}));
      overlapMsg = j?.message || 'That start time won’t fit the full service duration (includes travel). Please choose another time.';
    } else if (!res.ok) {
      // Try to parse server json for overlap hint
      const j = await res.json().catch(() => ({}));
      if (j?.error === 'overlap' || /won’t fit the full service duration/i.test(j?.message || '')) {
        overlapMsg = j.message || 'That start time won’t fit the full service duration (includes travel). Please choose another time.';
      }
    }

    if (overlapMsg) {
      localStorage.setItem('flashMsg', JSON.stringify({ type: 'warn', text: overlapMsg }));
      setTimeout(() => {
        window.location.href = '/datetime?msg=' + encodeURIComponent(overlapMsg);
      }, 600);
      return;
    }

    if (!res.ok) throw new Error(`Booking failed: ${res.status}`);

    // Success
    $('#successMsg').classList.remove('hidden');
    $('#errorMsg').classList.add('hidden');

    localStorage.removeItem('bookingSelection');
    localStorage.removeItem('appointmentSelection');
    localStorage.removeItem('holdInfo');

    setTimeout(() => { window.location.href = '/thankyou'; }, 1500);
  } catch (err) {
    console.error(err);
    $('#errorMsg').classList.remove('hidden');
    const errBox = document.getElementById('errorMsg');
    if (errBox) errBox.textContent = 'Something went wrong. Please try again.';
    $('#successMsg').classList.add('hidden');
  }
}

// ====== INIT ======
document.addEventListener('DOMContentLoaded', async () => {
  console.log('DEBUG: Checkout page loaded');
  
  renderSummary();
  syncSubtotal();
  
  ['street', 'city', 'state', 'zip'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', debouncedRecalc);
  });
  
  // Try to estimate from server, but fallback to just showing subtotal
  const estimateSuccess = await estimateFromServer();
  console.log('DEBUG: estimateFromServer returned:', estimateSuccess);
  
  if (!estimateSuccess) {
    // Fallback: if address is empty, just use subtotal as total
    const stored = Number(window.__checkoutSubtotal || 0);
    if (Number.isFinite(stored) && stored > 0) {
      console.log('DEBUG: Using subtotal as total (no address):', stored);
      $('#sumMileageFee').textContent = fmt(0);
      $('#sumTax').textContent = fmt(0);
      $('#sumTotal').textContent = fmt(stored);
    }
  }

  const backBtn = $('#backBtn');
  if (backBtn) backBtn.addEventListener('click', () => history.back());

  const form = $('#checkoutForm');
  if (form) form.addEventListener('submit', handleSubmit);
});
