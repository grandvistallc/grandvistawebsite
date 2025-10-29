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
  
  CUSTOMER_SHEET_ID = '11jE8pvTUMQl6eRrt1KET9P9E4ENK1Nh1CpWKlD4JmQc',
  BOOKING_SHEET_ID = '152pBQmy7OKze84ShxJLj4MUPLFquHXjIvaTk-cCJYco',
  GOOGLE_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxS_sBvwxLOC3VRaK_oQT0G1noX8rORkPsEGAKA5X4-kvPp7y9zNJjA-FhiHkqEpyNC/exec',

  SHEET_AVAIL_TAB = 'Availability',
  SHEET_BOOKINGS_TAB = 'Bookings',
  SHEET_BLACKOUTS_TAB = 'Blackouts',
  CUSTOMER_TAB = 'Sheet1',
  BOOKING_TAB = 'Sheet1',

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

/* ========= ✅ Sitemap & Robots.txt (FIX) ========= */
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
async function getValues(range, sheetId = GOOGLE_SHEET_ID) {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range,
  });
  return res.data.values || [];
}
async function appendValues(range, rows, sheetId = GOOGLE_SHEET_ID) {
  const sheets = await getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
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

/* ========= Helper Functions ========= */
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

/* ========= Google Apps Script Helper ========= */
async function callGoogleAppsScript(action, data = {}) {
  try {
    if (!GOOGLE_APPS_SCRIPT_URL) {
      throw new Error('Google Apps Script URL not configured');
    }
    
    const response = await fetch(GOOGLE_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: action,
        ...data
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const text = await response.text();
    
    // Check if response is HTML (error page) instead of JSON
    if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
      throw new Error('Google Apps Script returned HTML error page instead of JSON');
    }
    
    const result = JSON.parse(text);
    return result;
  } catch (error) {
    console.error('Error calling Google Apps Script:', error.message);
    // Return a fallback response structure
    return {
      success: false,
      message: `Google Apps Script error: ${error.message}`,
      fallback: true
    };
  }
}

/* ========= Customer API Endpoints ========= */

// Get all customers
app.get('/api/customers', async (req, res) => {
  try {
    const result = await callGoogleAppsScript('getCustomers', {
      customerSheetId: CUSTOMER_SHEET_ID,
      bookingSheetId: BOOKING_SHEET_ID,
      customerTab: CUSTOMER_TAB,
      bookingTab: BOOKING_TAB
    });
    
    if (result.success) {
      res.json({ success: true, customers: result.customers || [] });
    } else if (result.fallback) {
      // Provide fallback demo data when Google Apps Script is not available
      const demoCustomers = [
        {
          id: '1',
          name: 'John Doe',
          email: 'john.doe@email.com',
          phone: '(555) 123-4567',
          address: '123 Main St',
          city: 'Anytown',
          state: 'CA',
          zip: '12345',
          vehicleInfo: '2020 Honda Civic',
          notes: 'Regular customer',
          createdDate: '2024-01-15',
          totalServices: 3,
          lastService: '2024-10-15'
        },
        {
          id: '2',
          name: 'Jane Smith',
          email: 'jane.smith@email.com',
          phone: '(555) 987-6543',
          address: '456 Oak Ave',
          city: 'Another City',
          state: 'CA',
          zip: '67890',
          vehicleInfo: '2019 Toyota Camry',
          notes: 'Demo customer data',
          createdDate: '2024-02-20',
          totalServices: 1,
          lastService: '2024-09-10'
        }
      ];
      res.json({ 
        success: true, 
        customers: demoCustomers,
        message: 'Demo data - Google Apps Script not connected',
        isDemoData: true
      });
    } else {
      res.status(500).json({ success: false, message: result.message || 'Failed to fetch customers' });
    }
  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch customers' });
  }
});

// Get specific customer with booking history
app.get('/api/customers/:id', async (req, res) => {
  try {
    const customerId = req.params.id;
    
    const result = await callGoogleAppsScript('getCustomer', {
      customerSheetId: CUSTOMER_SHEET_ID,
      bookingSheetId: BOOKING_SHEET_ID,
      customerTab: CUSTOMER_TAB,
      bookingTab: BOOKING_TAB,
      customerId: customerId
    });
    
    if (result.success) {
      res.json({ success: true, customer: result.customer, bookings: result.bookings || [] });
    } else if (result.fallback) {
      // Provide fallback demo data
      const demoCustomer = {
        id: customerId,
        name: 'Demo Customer',
        email: 'demo@email.com',
        phone: '(555) 123-4567',
        address: '123 Demo St',
        city: 'Demo City',
        state: 'CA',
        zip: '12345',
        vehicleInfo: '2020 Demo Car',
        notes: 'This is demo data',
        createdDate: '2024-01-15',
        totalServices: 2
      };
      
      const demoBookings = [
        {
          date: '2024-10-15',
          time: '10:00 AM',
          service: 'Full Detail',
          amount: '$150',
          notes: 'Demo booking'
        }
      ];
      
      res.json({ 
        success: true, 
        customer: demoCustomer, 
        bookings: demoBookings,
        message: 'Demo data - Google Apps Script not connected',
        isDemoData: true
      });
    } else {
      res.status(404).json({ success: false, message: result.message || 'Customer not found' });
    }
  } catch (error) {
    console.error('Error fetching customer details:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch customer details' });
  }
});

// Add new customer
app.post('/api/customers', async (req, res) => {
  try {
    const { name, email, phone, address, city, state, zip, vehicleInfo, notes } = req.body;
    
    if (!name || !email) {
      return res.status(400).json({ success: false, message: 'Name and email are required' });
    }
    
    const result = await callGoogleAppsScript('addCustomer', {
      customerSheetId: CUSTOMER_SHEET_ID,
      customerTab: CUSTOMER_TAB,
      customerData: {
        name,
        email,
        phone: phone || '',
        address: address || '',
        city: city || '',
        state: state || '',
        zip: zip || '',
        vehicleInfo: vehicleInfo || '',
        notes: notes || ''
      }
    });
    
    if (result.success) {
      res.json({ success: true, message: 'Customer added successfully' });
    } else if (result.fallback) {
      res.json({ 
        success: true, 
        message: 'Customer would be added to Google Sheets when connected',
        isDemoMode: true
      });
    } else {
      res.status(400).json({ success: false, message: result.message || 'Failed to add customer' });
    }
  } catch (error) {
    console.error('Error adding customer:', error);
    res.status(500).json({ success: false, message: 'Failed to add customer' });
  }
});

// Sync customers from bookings (automatically detect and add new customers)
app.post('/api/customers/sync-from-bookings', async (req, res) => {
  try {
    const result = await callGoogleAppsScript('syncCustomersFromBookings', {
      customerSheetId: CUSTOMER_SHEET_ID,
      bookingSheetId: BOOKING_SHEET_ID,
      customerTab: CUSTOMER_TAB,
      bookingTab: BOOKING_TAB
    });
    
    if (result.success) {
      res.json({ 
        success: true, 
        message: result.message || `Synced ${result.newCustomersCount || 0} new customers from bookings`,
        newCustomersCount: result.newCustomersCount || 0
      });
    } else if (result.fallback) {
      res.json({ 
        success: true, 
        message: 'Sync would process bookings when Google Apps Script is connected',
        newCustomersCount: 0,
        isDemoMode: true
      });
    } else {
      res.status(500).json({ success: false, message: result.message || 'Failed to sync customers from bookings' });
    }
  } catch (error) {
    console.error('Error syncing customers from bookings:', error);
    res.status(500).json({ success: false, message: 'Failed to sync customers from bookings' });
  }
});

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
      const capMap = capacityMapForDateFromSnapshot(iso, snap);
      const hasOpen = [...capMap.entries()].some(([t, c]) => c > 0);
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
app.get('/customers',  (req, res) => res.sendFile(path.join(VIEWS_DIR, 'Customers.html')));
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
app.get('/test',       (req, res) => res.sendFile(path.join(VIEWS_DIR, 'test.html')));

app.get(['/Contact', '/Contact.html'], (req, res) => res.redirect(301, '/contact'));

/* ========= Start ========= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
