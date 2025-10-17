/* =========================
   GrandVista Services (static cards + template breakdowns)
   ========================= */

console.log('📄 services.js loading...');

/* --- NEW: Always start fresh on Services page --- */
(function clearBookingStateOnLoad() {
  try {
    console.log('🧹 Clearing previous booking state from localStorage');
    localStorage.removeItem('bookingSelection');
    localStorage.removeItem('appointmentSelection');
    localStorage.removeItem('holdInfo');
    localStorage.removeItem('customerInfo');
    localStorage.removeItem('cartAddOns');
    localStorage.removeItem('flashMsg');
    // If you had any previous keys from older versions, clear them too (no-op if missing):
    localStorage.removeItem('selectedPackage');
    console.log('✅ Previous state cleared');
  } catch {}
})();

// -------- State --------
const state = {
  data: { packages: [], addons: [], vehicleSizes: [] },
  selectedPackageId: null,         // 'gloss-shield' | 'interior-revival' | 'showroom-rebirth'
  selectedPackageIds: new Set(),   // Track ALL selected packages (primary + bonus)
  bonusPackageId: null,            // 'gloss-shield' when auto-applied via interior-revival
  selectedSizeId: null,            // 'car' | 'suv' | 'truck'
  selectedAddons: new Set(),       // checkbox addons (paint-correction)
  hairLevel: null,                 // 'none' | 'normal' | 'heavy'  (start null to force explicit choice)
  stainLevel: 'none',              // 'none' | 'light' | 'medium' | 'heavy'
  odorLevel: 'none'                // 'none' | 'light' | 'medium' | 'heavy'
};

// -------- Shortcuts --------
const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const fmt = (n) => '$' + (Number(n || 0)).toLocaleString();

// -------- Config / Tables --------
const STAIN_PRICES = { none: 0, light: 30, medium: 50, heavy: 75 };
const ODOR_PRICES  = { none: 0, light: 40, medium: 60, heavy: 80 };

function hairPrice(level, sizeId) {
  if (level !== 'heavy') return 0;
  if (sizeId === 'truck') return 50;
  if (sizeId === 'suv')   return 40;
  return 25; // car
}

function paintCorrectionForSize(sizeId) {
  if (sizeId === 'truck') return 150;
  if (sizeId === 'suv')   return 125;
  return 100; // car
}

// -------- Data bootstrap (from STATIC HTML) --------
function bootstrapPackagesFromDOM() {
  const cards = $$('#packagesGrid .package-card');
  if (!cards.length) return false;

  state.data.packages = cards.map(card => {
    const id    = card.dataset.pkg;
    const name  = card.querySelector('.card-title')?.textContent?.trim() || '';
    const price = Number((card.querySelector('.price')?.textContent || '0').replace(/[^0-9.]/g, '')) || 0;
    const desc  = card.querySelector('.desc')?.textContent?.trim() || '';
    const dur   = card.querySelector('.meta')?.textContent?.trim() || '';

    // Showroom includes correction already → no addon
    const addons = (id === 'showroom-rebirth') ? [] : ['paint-correction'];

    return { id, name, basePrice: price, description: desc, duration: dur, addons };
  });

  // Vehicle sizes (static)
  state.data.vehicleSizes = [
    { id: "car",   label: "Car / Sedan",           fee: 0  },
    { id: "suv",   label: "SUV / Crossover",       fee: 10 },
    { id: "truck", label: "Truck / Van / 3rd Row", fee: 20 }
  ];

  // Addons (checkbox list shown under Add-ons)
  state.data.addons = [
    { id: "paint-correction",  name: "Paint Correction (1 step)" }
  ];

  bindStaticPackageEvents();
  return true;
}

// Auto-apply FREE Exterior Refresh when Interior Revival is selected
// But also allow independent selection of Exterior Refresh
function applyInteriorExteriorDeal() {
  const interiorCard = $('.package-card[data-pkg="interior-revival"]');
  const exteriorCard = $('.package-card[data-pkg="gloss-shield"]');
  const exteriorRadio = $('input[name="package"][value="gloss-shield"]');
  const exteriorPriceEl = exteriorCard?.querySelector('.price');
  
  // Case 1: Interior Revival is selected
  if (state.selectedPackageId === 'interior-revival') {
    // Auto-mark exterior as bonus
    state.bonusPackageId = 'gloss-shield';
    
    // Add exterior to the selected set ONLY if not already independently selected
    if (!state.selectedPackageIds.has('gloss-shield')) {
      state.selectedPackageIds.add('gloss-shield');
    }
    
    // Visually select exterior card
    if (exteriorCard) exteriorCard.classList.add('selected');
    if (exteriorRadio) exteriorRadio.checked = true;
    
    // Display crossed-out price + green $0
    if (exteriorPriceEl) {
      exteriorPriceEl.classList.add('free-bonus');
      exteriorPriceEl.innerHTML = '<span class="strikethrough">$150</span> <span class="bonus-price">$0</span>';
    }
  } 
  // Case 2: Interior Revival is deselected
  else {
    // If exterior was ONLY a bonus (not independently selected), remove it
    if (state.bonusPackageId === 'gloss-shield' && state.selectedPackageIds.has('gloss-shield')) {
      state.selectedPackageIds.delete('gloss-shield');
    }
    
    state.bonusPackageId = null;
    
    // Deselect exterior only if it's NOT independently selected
    if (!state.selectedPackageIds.has('gloss-shield')) {
      if (exteriorCard) exteriorCard.classList.remove('selected');
      if (exteriorRadio) exteriorRadio.checked = false;
    }
    
    // Restore exterior price to normal
    if (exteriorPriceEl && !state.selectedPackageIds.has('gloss-shield')) {
      exteriorPriceEl.classList.remove('free-bonus');
      exteriorPriceEl.innerHTML = '$150';
    }
  }
}


// Bind change + details to existing DOM (no re-render)
function bindStaticPackageEvents() {
  // Package select
  $$('#packagesGrid .package-card input[type="radio"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const pkgId = radio.value;
      const card = radio.closest('.package-card');
      
      // Determine if this is the primary package or bonus selection
      const isBonus = state.bonusPackageId === pkgId && state.selectedPackageId === 'interior-revival';
      
      // If clicking exterior refresh (gloss-shield)
      if (pkgId === 'gloss-shield') {
        if (state.selectedPackageId === 'interior-revival') {
          // Interior is selected → exterior becomes independent selection
          state.selectedPackageIds.add('gloss-shield');
          state.bonusPackageId = null; // No longer a bonus, it's independent
          card?.classList.add('selected');
          
          // Update price to normal $150
          const priceEl = card?.querySelector('.price');
          if (priceEl) {
            priceEl.classList.remove('free-bonus');
            priceEl.innerHTML = '$150';
          }
        } else {
          // No other package selected → normal selection
          $$('#packagesGrid .package-card').forEach(c => c.classList.remove('selected'));
          $$('#packagesGrid .package-card input[type="radio"]').forEach(r => r.checked = false);
          
          state.selectedPackageId = pkgId;
          state.selectedPackageIds.clear();
          state.selectedPackageIds.add(pkgId);
          state.bonusPackageId = null;
          card?.classList.add('selected');
        }
      }
      // If clicking interior revival
      else if (pkgId === 'interior-revival') {
        // Clear all previous selections and reset
        $$('#packagesGrid .package-card').forEach(c => c.classList.remove('selected'));
        $$('#packagesGrid .package-card input[type="radio"]').forEach(r => r.checked = false);
        
        state.selectedPackageId = pkgId;
        state.selectedPackageIds.clear();
        state.selectedPackageIds.add(pkgId);
        state.bonusPackageId = null;
        
        card?.classList.add('selected');
        radio.checked = true;
        
        // Apply the bonus deal (auto-selects exterior refresh as bonus)
        applyInteriorExteriorDeal();
      }
      // If clicking showroom rebirth or other packages
      else {
        $$('#packagesGrid .package-card').forEach(c => c.classList.remove('selected'));
        $$('#packagesGrid .package-card input[type="radio"]').forEach(r => r.checked = false);
        
        state.selectedPackageId = pkgId;
        state.selectedPackageIds.clear();
        state.selectedPackageIds.add(pkgId);
        state.bonusPackageId = null;
        card?.classList.add('selected');
        
        // Reset exterior refresh pricing if it was a bonus
        const exteriorCard = $('.package-card[data-pkg="gloss-shield"]');
        const exteriorPriceEl = exteriorCard?.querySelector('.price');
        if (exteriorPriceEl && !state.selectedPackageIds.has('gloss-shield')) {
          exteriorPriceEl.classList.remove('free-bonus');
          exteriorPriceEl.innerHTML = '$150';
        }
      }

      // prune add-ons when package changes
      const pkg = currentPackage();
      const allowed = new Set(pkg?.addons || []);
      [...state.selectedAddons].forEach(id => { if (!allowed.has(id)) state.selectedAddons.delete(id); });

      renderAddons();   // respect showroom rule
      calcTotals();
    });
  });

  // View details
  $$('#packagesGrid .details-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.open;
      const pkg = state.data.packages.find(p => p.id === id);
      if (pkg) openPkgModal(pkg);
    });
  });
}

// -------- Accessors --------
function currentPackage() {
  return state.data.packages.find(p => p.id === state.selectedPackageId) || null;
}
function currentSize() {
  return state.data.vehicleSizes.find(s => s.id === state.selectedSizeId) || null;
}
function addonById(id) {
  return state.data.addons.find(a => a.id === id) || null;
}

// -------- Rendering: Sizes / Hair / Severity / Addons --------
function renderSizes() {
  const list = $('#sizeList'); list.innerHTML = '';
  state.data.vehicleSizes.forEach(s => {
    const label = document.createElement('label');
    label.className = 'chip' + (state.selectedSizeId===s.id ? ' selected' : '');
    label.innerHTML = `
      <input type="radio" name="size" value="${s.id}" class="radio visually-hidden" ${state.selectedSizeId===s.id?'checked':''}/>
      <span class="chip-label">${s.label}</span>
      <span class="chip-fee">${s.fee ? '(+'+fmt(s.fee)+')' : ''}</span>
    `;
    label.querySelector('input').addEventListener('change', () => {
      state.selectedSizeId = s.id;
      $$('#sizeList .chip').forEach(el => el.classList.remove('selected'));
      label.classList.add('selected');
      // size impacts hair heavy + paint correction labels/prices
      renderAddons();
      renderHair();
      calcTotals();
    });
    list.appendChild(label);
  });
}

function renderHair() {
  const list = $('#hairList'); list.innerHTML = '';
  const sizeId = state.selectedSizeId || 'car';
  const heavy = hairPrice('heavy', sizeId);

  const opts = [
    { id: 'none',   label: 'No Hair',         feeText: '' },
    { id: 'normal', label: 'Pet Hair',        feeText: '' },
    { id: 'heavy',  label: 'Heavy Pet Hair',  feeText: `(+${fmt(heavy)})` }
  ];

  opts.forEach(opt => {
    const label = document.createElement('label');
    const sel = state.hairLevel === opt.id;
    label.className = 'chip' + (sel ? ' selected' : '');
    label.innerHTML = `
      <input type="radio" name="hair" value="${opt.id}" class="radio visually-hidden" ${sel?'checked':''}/>
      <span class="chip-label">${opt.label}</span>
      ${opt.feeText ? `<span class="chip-fee">${opt.feeText}</span>` : ''}
    `;
    label.querySelector('input').addEventListener('change', () => {
      state.hairLevel = opt.id;
      $$('#hairList .chip').forEach(el => el.classList.remove('selected'));
      label.classList.add('selected');
      calcTotals();
    });
    list.appendChild(label);
  });
}

function renderSeverityChips(containerId, current, priceMap) {
  const list = $(containerId); list.innerHTML = '';
  const groupName = (containerId === '#stainList') ? 'stain' : 'odor';
  const items = [
    { id: 'none',   label: 'None',   fee: priceMap.none },
    { id: 'light',  label: 'Light',  fee: priceMap.light },
    { id: 'medium', label: 'Medium', fee: priceMap.medium },
    { id: 'heavy',  label: 'Heavy',  fee: priceMap.heavy }
  ];
  items.forEach(opt => {
    const sel = current === opt.id;
    const label = document.createElement('label');
    label.className = 'chip' + (sel ? ' selected' : '');
    label.innerHTML = `
      <input type="radio" name="${groupName}" value="${opt.id}" class="radio visually-hidden" ${sel?'checked':''}/>
      <span class="chip-label">${opt.label}</span>
      ${opt.fee ? `<span class="chip-fee">(+${fmt(opt.fee).replace('$','')})</span>` : ''}
    `;
    // normal change
    label.querySelector('input').addEventListener('change', () => {
      if (containerId === '#stainList') state.stainLevel = opt.id;
      if (containerId === '#odorList')  state.odorLevel  = opt.id;
      $$(containerId + ' .chip').forEach(el => el.classList.remove('selected'));
      label.classList.add('selected');
      calcTotals();
    });
    // toggle off if clicking the same option
    label.addEventListener('click', (ev) => {
      const cur = (containerId === '#stainList') ? state.stainLevel : state.odorLevel;
      if (cur === opt.id && opt.id !== 'none') {
        ev.preventDefault();
        if (containerId === '#stainList') state.stainLevel = 'none';
        if (containerId === '#odorList')  state.odorLevel  = 'none';
        renderSeverityChips(containerId, 'none', priceMap);
        calcTotals();
      }
    });
    list.appendChild(label);
  });
}

function renderAddons() {
  const wrap = $('#addonsList'); wrap.innerHTML = '';
  const pkg = currentPackage();
  const allowed = new Set(pkg?.addons || []);
  const addons = state.data.addons.filter(a => allowed.has(a.id));

  addons.forEach(a => {
    const checked = state.selectedAddons.has(a.id);
    let priceText = '';
    if (a.id === 'paint-correction') {
      priceText = fmt(paintCorrectionForSize(state.selectedSizeId || 'car'));
    }
    const row = document.createElement('label');
    row.className = 'row addon-row' + (checked ? ' selected' : '');
    row.innerHTML = `
      <input type="checkbox" value="${a.id}" class="checkbox" ${checked?'checked':''}/>
      <span class="addon-name">${a.name}</span>
      <span class="spacer"></span>
      <span class="addon-price">${priceText}</span>
    `;
    row.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) {
        state.selectedAddons.add(a.id);
        row.classList.add('selected');
      } else {
        state.selectedAddons.delete(a.id);
        row.classList.remove('selected');
      }
      calcTotals();
    });
    wrap.appendChild(row);
  });
}

// -------- Modal (reads <template id="tmpl-...">) --------
function openPkgModal(pkg) {
  // Prefer template content if present
  const tpl = document.getElementById(`tmpl-${pkg.id}`);
  const modal = $('#pkgModal');

  // Header fields (from template data-* if available, else from pkg)
  const title = tpl?.dataset?.name || pkg?.name || '';
  const price = Number(tpl?.dataset?.price ?? (pkg?.basePrice || 0));
  const duration = tpl?.dataset?.duration || pkg?.duration || '';
  const desc = tpl?.dataset?.desc || pkg?.description || '';

  $('#pkgModalTitle').textContent   = title;
  $('#pkgModalPrice').textContent   = fmt(price);
  $('#pkgModalDuration').textContent= duration;
  $('#pkgModalDesc').textContent    = desc;

  const incWrap   = $('#pkgModalIncludesWrap');
  const bonusWrap = $('#pkgModalBonusesWrap');
  const incUL     = $('#pkgModalIncludes');
  const bonusUL   = $('#pkgModalBonuses');

  // Clear
  incUL.innerHTML = '';
  bonusUL.innerHTML = '';

  if (tpl) {
    const frag = tpl.content.cloneNode(true);
    const incDiv   = frag.querySelector('.includes');
    const bonusDiv = frag.querySelector('.bonuses');

    if (incDiv && incDiv.innerHTML.trim()) {
      // incDiv contains <li> items directly → inject into UL
      incUL.innerHTML = incDiv.innerHTML;
      incWrap.classList.remove('hidden');
    } else {
      incWrap.classList.add('hidden');
    }

    if (bonusDiv && bonusDiv.innerHTML.trim()) {
      bonusUL.innerHTML = bonusDiv.innerHTML;
      bonusWrap.classList.remove('hidden');
    } else {
      bonusWrap.classList.add('hidden');
    }
  } else {
    // Fallback to pkg arrays (if any)
    if (Array.isArray(pkg.includes) && pkg.includes.length) {
      incUL.innerHTML = pkg.includes.map(i => `<li>${i}</li>`).join('');
      incWrap.classList.remove('hidden');
    } else { incWrap.classList.add('hidden'); }

    if (Array.isArray(pkg.bonuses) && pkg.bonuses.length) {
      bonusUL.innerHTML = pkg.bonuses.map(b => `<li>${b}</li>`).join('');
      bonusWrap.classList.remove('hidden');
    } else { bonusWrap.classList.add('hidden'); }
  }

  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closePkgModal() {
  $('#pkgModal').classList.add('hidden');
  document.body.style.overflow = '';
}
document.addEventListener('click', (e) => {
  if (e.target.matches('[data-close="true"]') || e.target.classList.contains('modal-backdrop')) {
    closePkgModal();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#pkgModal').classList.contains('hidden')) closePkgModal();
});

// -------- Totals / Validation --------
function setRow(sel, val) { const el = $(sel); if (el) el.classList.toggle('hidden', !val); }

function updateContinueState() {
  const hasPkg  = !!state.selectedPackageId;
  const hasSize = !!state.selectedSizeId;
  const hasHair = !!state.hairLevel;
  $('#continueBtn').disabled = !(hasPkg && hasSize && hasHair);
  $('#sizeRequiredMsg').classList.toggle('hidden', !!state.selectedSizeId);
  $('#hairRequiredMsg').classList.toggle('hidden', !!state.hairLevel);
  $('#validationMsg').classList.add('hidden');
}

function calcTotals() {
  const pkg   = currentPackage();
  const size  = currentSize();
  const base  = pkg ? Number(pkg.basePrice) : 0;
  const sFee  = size ? Number(size.fee) || 0 : 0;
  const hair  = hairPrice(state.hairLevel || 'none', state.selectedSizeId);
  const stain = STAIN_PRICES[state.stainLevel || 'none'] || 0;
  const odor  = ODOR_PRICES[state.odorLevel  || 'none'] || 0;

  let paint = 0, addons = 0;
  for (const id of state.selectedAddons) {
    if (id === 'paint-correction') paint += paintCorrectionForSize(state.selectedSizeId || 'car');
    else addons += 0; // (no other checkbox addons right now)
  }

  // Breakdown rows (only if have value)
  setRow('#rowHair',  hair);
  setRow('#rowStain', stain);
  setRow('#rowOdor',  odor);
  setRow('#rowPaint', paint);
  setRow('#rowAddons', addons);

  $('#basePrice').textContent   = fmt(base);
  $('#sizeFee').textContent     = fmt(sFee);
  $('#hairTotal').textContent   = fmt(hair);
  $('#stainTotal').textContent  = fmt(stain);
  $('#odorTotal').textContent   = fmt(odor);
  $('#paintTotal').textContent  = fmt(paint);
  $('#addonsTotal').textContent = fmt(addons);

  const subtotal = base + sFee + hair + stain + odor + paint + addons;
  $('#subtotal').textContent = fmt(subtotal);

  updateContinueState();
}

function validateSelection() {
  const hasPackage = !!state.selectedPackageId;
  const hasSize = !!state.selectedSizeId;
  const hasHair = !!state.hairLevel;
  const ok = hasPackage && hasSize && hasHair;
  
  console.log('🔍 validateSelection() results:');
  console.log('  Package selected:', hasPackage ? '✅' : '❌', `(${state.selectedPackageId})`);
  console.log('  Size selected:', hasSize ? '✅' : '❌', `(${state.selectedSizeId})`);
  console.log('  Hair level selected:', hasHair ? '✅' : '❌', `(${state.hairLevel})`);
  console.log('  Overall result:', ok ? '✅ VALID' : '❌ INVALID');
  
  $('#validationMsg').classList.toggle('hidden', ok);
  $('#sizeRequiredMsg').classList.toggle('hidden', !!state.selectedSizeId);
  $('#hairRequiredMsg').classList.toggle('hidden', !!state.hairLevel);
  return ok;
}

function persistAndContinue() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  persistAndContinue() CALLED - STARTING BOOKING SAVE PROCESS  ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');
  
  console.log('📋 Current State:');
  console.log('  selectedPackageId:', state.selectedPackageId);
  console.log('  selectedSizeId:', state.selectedSizeId);
  console.log('  hairLevel:', state.hairLevel);
  console.log('  stainLevel:', state.stainLevel);
  console.log('  odorLevel:', state.odorLevel);
  console.log('  selectedAddons:', Array.from(state.selectedAddons));
  console.log('');
  
  console.log('🔍 Validating selection...');
  
  if (!validateSelection()) {
    console.log('❌ VALIDATION FAILED - Stopping here');
    return;
  }

  const pkg  = currentPackage();
  const size = currentSize();
  
  console.log('✅ Validation passed');
  console.log('  Package:', pkg?.name);
  console.log('  Size:', size?.label);

  const addonsPersist = [...state.selectedAddons].map(id => {
    if (id === 'paint-correction') {
      const price = paintCorrectionForSize(state.selectedSizeId);
      return { id, name: 'Paint Correction (1 step)', priceFrom: price, priceTo: price };
    }
    return null;
  }).filter(Boolean);

  const subtotalText = $('#subtotal').textContent;
  const subtotalNum = Number(subtotalText.replace(/[^0-9.]/g,''));
  console.log('💰 Pricing:');
  console.log('  Subtotal text:', subtotalText);
  console.log('  Subtotal number:', subtotalNum);

  const selection = {
    step: 'services',
    packageId: state.selectedPackageId,
    packageName: pkg?.name,
    basePrice: Number(pkg?.basePrice || 0),
    sizeId: state.selectedSizeId,
    sizeLabel: size?.label,
    sizeFee: Number(size?.fee || 0),
    hair:  { level: state.hairLevel, priceFrom: hairPrice(state.hairLevel, state.selectedSizeId), priceTo: hairPrice(state.hairLevel, state.selectedSizeId) },
    stain: { level: state.stainLevel, price: STAIN_PRICES[state.stainLevel] || 0 },
    odor:  { level: state.odorLevel,  price: ODOR_PRICES[state.odorLevel]  || 0 },
    addons: addonsPersist,
    subtotal: subtotalNum,
    travelFees: [], // (if you later wire distance)
    bonusPackageId: state.bonusPackageId || null, // Include bonus Exterior Refresh if applicable
    bonusPackageName: state.bonusPackageId === 'gloss-shield' ? 'Exterior Refresh (FREE)' : null,
    selectedPackageIds: Array.from(state.selectedPackageIds) // All selected packages (primary + bonus)
  };

  console.log('📦 Selection object to persist:');
  console.log(JSON.stringify(selection, null, 2));
  
  try { 
    localStorage.setItem('bookingSelection', JSON.stringify(selection));
    console.log('✅ Successfully saved bookingSelection to localStorage');
    console.log('  Keys in storage now:', Object.keys(localStorage));
  } catch (e) {
    console.error('❌ FAILED to save to localStorage:', e);
    return;
  }
  
  console.log('');
  console.log('🔄 Redirecting to /datetime...');
  window.location.href = '/datetime';
}

// -------- Init --------
function resetUISelections() {
  // Explicitly uncheck any previously checked radios (browser back-cache safe)
  $$('#packagesGrid .package-card input[type="radio"]').forEach(r => r.checked = false);
  $$('#packagesGrid .package-card').forEach(c => c.classList.remove('selected'));
  
  // Reset price displays for all cards
  $$('#packagesGrid .package-card .price').forEach(p => {
    p.classList.remove('free-bonus');
    const pkgCard = p.closest('.package-card');
    const pkgId = pkgCard?.dataset.pkg;
    if (pkgId === 'gloss-shield') p.innerHTML = '$150';
    else if (pkgId === 'interior-revival') p.innerHTML = '$270';
    else if (pkgId === 'showroom-rebirth') p.innerHTML = '$480';
  });
  
  // Reset state to enforce fresh start
  state.selectedPackageId = null;
  state.selectedPackageIds.clear();
  state.bonusPackageId = null;
  state.selectedSizeId = null;
  state.selectedAddons.clear();
  state.hairLevel = null;
  state.stainLevel = 'none';
  state.odorLevel = 'none';
}

function init() {
  // read from static DOM
  console.log('[Services] Starting init...');
  bootstrapPackagesFromDOM();

  // FORCE FRESH START (do NOT restore from storage)
  resetUISelections();

  // Render rest
  renderSizes();
  renderHair();
  renderSeverityChips('#stainList', state.stainLevel, STAIN_PRICES);
  renderSeverityChips('#odorList',  state.odorLevel,  ODOR_PRICES);
  renderAddons();
  calcTotals();

  // Buttons
  const continueBtn = $('#continueBtn');
  const backBtn = $('#backBtn');
  
  console.log('[Services] Continue button found:', !!continueBtn);
  console.log('[Services] Back button found:', !!backBtn);
  
  if (continueBtn) {
    continueBtn.addEventListener('click', (e) => {
      console.log('[Services] ⭐ CONTINUE BUTTON CLICKED');
      console.log('Event:', e);
      persistAndContinue();
    });
    console.log('[Services] ✓ Continue button listener attached');
  } else {
    console.error('[Services] ✗ Continue button NOT FOUND');
  }
  
  if (backBtn) {
    backBtn.addEventListener('click', () => history.back());
  }
}

document.addEventListener('DOMContentLoaded', () => {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  DOMContentLoaded: Services page is ready                      ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');
  init();
});
