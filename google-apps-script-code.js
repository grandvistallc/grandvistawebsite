/**
 * Google Apps Script for Customer Dashboard
 * Deploy this as a web app and use the provided URL
 */

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    
    switch (action) {
      case 'getCustomers':
        return getCustomers(data);
      case 'getCustomer':
        return getCustomer(data);
      case 'addCustomer':
        return addCustomer(data);
      case 'syncCustomersFromBookings':
        return syncCustomersFromBookings(data);
      default:
        return ContentService
          .createTextOutput(JSON.stringify({ success: false, message: 'Unknown action' }))
          .setMimeType(ContentService.MimeType.JSON);
    }
  } catch (error) {
    console.error('Error in doPost:', error);
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: true, message: 'Customer Dashboard API is running' }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Get all customers with service statistics
 */
function getCustomers(data) {
  try {
    const customerSheetId = data.customerSheetId;
    const bookingSheetId = data.bookingSheetId;
    const customerTab = data.customerTab || 'Sheet1';
    const bookingTab = data.bookingTab || 'Sheet1';
    
    // Open customer database sheet
    const customerSheet = SpreadsheetApp.openById(customerSheetId).getSheetByName(customerTab);
    const customerData = customerSheet.getDataRange().getValues();
    
    if (customerData.length === 0) {
      return ContentService
        .createTextOutput(JSON.stringify({ success: true, customers: [] }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    const headers = customerData[0];
    const customerRows = customerData.slice(1);
    
    // Find column indices
    const getColumnIndex = (searchTerms) => {
      for (const term of searchTerms) {
        const index = headers.findIndex(header => 
          header && header.toString().toLowerCase().includes(term.toLowerCase())
        );
        if (index !== -1) return index;
      }
      return -1;
    };
    
    const nameCol = getColumnIndex(['name']);
    const emailCol = getColumnIndex(['email', 'e-mail']);
    const phoneCol = getColumnIndex(['phone', 'telephone', 'mobile']);
    const addressCol = getColumnIndex(['address', 'street']);
    const cityCol = getColumnIndex(['city']);
    const stateCol = getColumnIndex(['state', 'province']);
    const zipCol = getColumnIndex(['zip', 'postal', 'code']);
    const vehicleCol = getColumnIndex(['vehicle', 'car', 'auto']);
    const notesCol = getColumnIndex(['notes', 'comments']);
    const dateCol = getColumnIndex(['date', 'created', 'added']);
    
    // Get booking data for statistics
    let bookingData = [];
    try {
      const bookingSheet = SpreadsheetApp.openById(bookingSheetId).getSheetByName(bookingTab);
      bookingData = bookingSheet.getDataRange().getValues().slice(1); // Skip headers
    } catch (error) {
      console.warn('Could not read booking data:', error);
    }
    
    // Process customers
    const customers = customerRows.map((row, index) => {
      const customer = {
        id: (index + 2).toString(),
        name: nameCol >= 0 ? (row[nameCol] || '').toString() : '',
        email: emailCol >= 0 ? (row[emailCol] || '').toString() : '',
        phone: phoneCol >= 0 ? (row[phoneCol] || '').toString() : '',
        address: addressCol >= 0 ? (row[addressCol] || '').toString() : '',
        city: cityCol >= 0 ? (row[cityCol] || '').toString() : '',
        state: stateCol >= 0 ? (row[stateCol] || '').toString() : '',
        zip: zipCol >= 0 ? (row[zipCol] || '').toString() : '',
        vehicleInfo: vehicleCol >= 0 ? (row[vehicleCol] || '').toString() : '',
        notes: notesCol >= 0 ? (row[notesCol] || '').toString() : '',
        createdDate: dateCol >= 0 ? (row[dateCol] || '').toString() : '',
      };
      
      // Calculate service statistics
      const customerBookings = bookingData.filter(booking => {
        const bookingEmail = booking[2] ? booking[2].toString() : '';
        const bookingPhone = booking[3] ? booking[3].toString() : '';
        return (customer.email && bookingEmail.toLowerCase() === customer.email.toLowerCase()) ||
               (customer.phone && bookingPhone === customer.phone);
      });
      
      customer.totalServices = customerBookings.length;
      customer.lastService = customerBookings.length > 0 
        ? (customerBookings[customerBookings.length - 1][0] || 'Unknown').toString()
        : 'Never';
      
      return customer;
    });
    
    return ContentService
      .createTextOutput(JSON.stringify({ success: true, customers }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    console.error('Error in getCustomers:', error);
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Get specific customer with booking history
 */
function getCustomer(data) {
  try {
    const customerSheetId = data.customerSheetId;
    const bookingSheetId = data.bookingSheetId;
    const customerTab = data.customerTab || 'Sheet1';
    const bookingTab = data.bookingTab || 'Sheet1';
    const customerId = data.customerId;
    
    const rowIndex = parseInt(customerId) - 2;
    
    // Open customer database sheet
    const customerSheet = SpreadsheetApp.openById(customerSheetId).getSheetByName(customerTab);
    const customerData = customerSheet.getDataRange().getValues();
    
    if (customerData.length === 0 || rowIndex < 0 || rowIndex >= customerData.length - 1) {
      return ContentService
        .createTextOutput(JSON.stringify({ success: false, message: 'Customer not found' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    const headers = customerData[0];
    const row = customerData[rowIndex + 1]; // +1 because we skip headers
    
    // Find column indices
    const getColumnIndex = (searchTerms) => {
      for (const term of searchTerms) {
        const index = headers.findIndex(header => 
          header && header.toString().toLowerCase().includes(term.toLowerCase())
        );
        if (index !== -1) return index;
      }
      return -1;
    };
    
    const nameCol = getColumnIndex(['name']);
    const emailCol = getColumnIndex(['email', 'e-mail']);
    const phoneCol = getColumnIndex(['phone', 'telephone', 'mobile']);
    const addressCol = getColumnIndex(['address', 'street']);
    const cityCol = getColumnIndex(['city']);
    const stateCol = getColumnIndex(['state', 'province']);
    const zipCol = getColumnIndex(['zip', 'postal', 'code']);
    const vehicleCol = getColumnIndex(['vehicle', 'car', 'auto']);
    const notesCol = getColumnIndex(['notes', 'comments']);
    const dateCol = getColumnIndex(['date', 'created', 'added']);
    
    const customer = {
      id: customerId,
      name: nameCol >= 0 ? (row[nameCol] || '').toString() : '',
      email: emailCol >= 0 ? (row[emailCol] || '').toString() : '',
      phone: phoneCol >= 0 ? (row[phoneCol] || '').toString() : '',
      address: addressCol >= 0 ? (row[addressCol] || '').toString() : '',
      city: cityCol >= 0 ? (row[cityCol] || '').toString() : '',
      state: stateCol >= 0 ? (row[stateCol] || '').toString() : '',
      zip: zipCol >= 0 ? (row[zipCol] || '').toString() : '',
      vehicleInfo: vehicleCol >= 0 ? (row[vehicleCol] || '').toString() : '',
      notes: notesCol >= 0 ? (row[notesCol] || '').toString() : '',
      createdDate: dateCol >= 0 ? (row[dateCol] || '').toString() : '',
    };
    
    // Get booking history
    let bookings = [];
    try {
      const bookingSheet = SpreadsheetApp.openById(bookingSheetId).getSheetByName(bookingTab);
      const bookingData = bookingSheet.getDataRange().getValues().slice(1); // Skip headers
      
      bookings = bookingData.filter(booking => {
        const bookingEmail = booking[2] ? booking[2].toString() : '';
        const bookingPhone = booking[3] ? booking[3].toString() : '';
        return (customer.email && bookingEmail.toLowerCase() === customer.email.toLowerCase()) ||
               (customer.phone && bookingPhone === customer.phone);
      }).map(booking => ({
        date: booking[0] ? booking[0].toString() : '',
        time: booking[1] ? booking[1].toString() : '',
        email: booking[2] ? booking[2].toString() : '',
        phone: booking[3] ? booking[3].toString() : '',
        service: booking[4] ? booking[4].toString() : '',
        vehicle: booking[5] ? booking[5].toString() : '',
        amount: booking[6] ? booking[6].toString() : '',
        address: booking[7] ? booking[7].toString() : '',
        notes: booking[8] ? booking[8].toString() : ''
      }));
    } catch (error) {
      console.warn('Could not read booking data:', error);
    }
    
    customer.totalServices = bookings.length;
    
    return ContentService
      .createTextOutput(JSON.stringify({ success: true, customer, bookings }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    console.error('Error in getCustomer:', error);
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Add new customer
 */
function addCustomer(data) {
  try {
    const customerSheetId = data.customerSheetId;
    const customerTab = data.customerTab || 'Sheet1';
    const customerData = data.customerData;
    
    if (!customerData.name || !customerData.email) {
      return ContentService
        .createTextOutput(JSON.stringify({ success: false, message: 'Name and email are required' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // Open customer database sheet
    const customerSheet = SpreadsheetApp.openById(customerSheetId).getSheetByName(customerTab);
    const existingData = customerSheet.getDataRange().getValues();
    
    if (existingData.length === 0) {
      return ContentService
        .createTextOutput(JSON.stringify({ success: false, message: 'Customer sheet appears to be empty' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    const headers = existingData[0];
    const existingRows = existingData.slice(1);
    
    // Find column indices
    const getColumnIndex = (searchTerms) => {
      for (const term of searchTerms) {
        const index = headers.findIndex(header => 
          header && header.toString().toLowerCase().includes(term.toLowerCase())
        );
        if (index !== -1) return index;
      }
      return -1;
    };
    
    const nameCol = getColumnIndex(['name']);
    const emailCol = getColumnIndex(['email', 'e-mail']);
    const phoneCol = getColumnIndex(['phone', 'telephone', 'mobile']);
    const addressCol = getColumnIndex(['address', 'street']);
    const cityCol = getColumnIndex(['city']);
    const stateCol = getColumnIndex(['state', 'province']);
    const zipCol = getColumnIndex(['zip', 'postal', 'code']);
    const vehicleCol = getColumnIndex(['vehicle', 'car', 'auto']);
    const notesCol = getColumnIndex(['notes', 'comments']);
    const dateCol = getColumnIndex(['date', 'created', 'added']);
    
    if (nameCol < 0 || emailCol < 0) {
      return ContentService
        .createTextOutput(JSON.stringify({ success: false, message: 'Customer sheet must have Name and Email columns' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // Check if customer already exists
    const exists = existingRows.some(row => {
      const existingEmail = emailCol >= 0 ? (row[emailCol] || '').toString() : '';
      return existingEmail.toLowerCase() === customerData.email.toLowerCase();
    });
    
    if (exists) {
      return ContentService
        .createTextOutput(JSON.stringify({ success: false, message: 'Customer with this email already exists' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // Prepare new row
    const maxColumns = headers.length;
    const newRow = new Array(maxColumns).fill('');
    
    const currentDate = new Date().toISOString().split('T')[0];
    
    if (nameCol >= 0) newRow[nameCol] = customerData.name;
    if (emailCol >= 0) newRow[emailCol] = customerData.email;
    if (phoneCol >= 0) newRow[phoneCol] = customerData.phone || '';
    if (addressCol >= 0) newRow[addressCol] = customerData.address || '';
    if (cityCol >= 0) newRow[cityCol] = customerData.city || '';
    if (stateCol >= 0) newRow[stateCol] = customerData.state || '';
    if (zipCol >= 0) newRow[zipCol] = customerData.zip || '';
    if (vehicleCol >= 0) newRow[vehicleCol] = customerData.vehicleInfo || '';
    if (notesCol >= 0) newRow[notesCol] = customerData.notes || '';
    if (dateCol >= 0) newRow[dateCol] = currentDate;
    
    // Add the new row
    customerSheet.appendRow(newRow);
    
    return ContentService
      .createTextOutput(JSON.stringify({ success: true, message: 'Customer added successfully' }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    console.error('Error in addCustomer:', error);
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Sync customers from bookings
 */
function syncCustomersFromBookings(data) {
  try {
    const customerSheetId = data.customerSheetId;
    const bookingSheetId = data.bookingSheetId;
    const customerTab = data.customerTab || 'Sheet1';
    const bookingTab = data.bookingTab || 'Sheet1';
    
    // Open sheets
    const customerSheet = SpreadsheetApp.openById(customerSheetId).getSheetByName(customerTab);
    const bookingSheet = SpreadsheetApp.openById(bookingSheetId).getSheetByName(bookingTab);
    
    const customerData = customerSheet.getDataRange().getValues();
    const bookingData = bookingSheet.getDataRange().getValues();
    
    if (customerData.length === 0 || bookingData.length === 0) {
      return ContentService
        .createTextOutput(JSON.stringify({ success: false, message: 'Customer or booking sheet appears to be empty' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    const customerHeaders = customerData[0];
    const existingCustomers = customerData.slice(1);
    const bookingHeaders = bookingData[0];
    const bookingRows = bookingData.slice(1);
    
    // Find column indices for customer sheet
    const getColumnIndex = (headers, searchTerms) => {
      for (const term of searchTerms) {
        const index = headers.findIndex(header => 
          header && header.toString().toLowerCase().includes(term.toLowerCase())
        );
        if (index !== -1) return index;
      }
      return -1;
    };
    
    // Customer sheet columns
    const nameCol = getColumnIndex(customerHeaders, ['name']);
    const emailCol = getColumnIndex(customerHeaders, ['email', 'e-mail']);
    const phoneCol = getColumnIndex(customerHeaders, ['phone', 'telephone', 'mobile']);
    const addressCol = getColumnIndex(customerHeaders, ['address', 'street']);
    const cityCol = getColumnIndex(customerHeaders, ['city']);
    const stateCol = getColumnIndex(customerHeaders, ['state', 'province']);
    const zipCol = getColumnIndex(customerHeaders, ['zip', 'postal', 'code']);
    const vehicleCol = getColumnIndex(customerHeaders, ['vehicle', 'car', 'auto']);
    const notesCol = getColumnIndex(customerHeaders, ['notes', 'comments']);
    const dateCol = getColumnIndex(customerHeaders, ['date', 'created', 'added']);
    
    // Booking sheet columns - flexible detection
    const bookingEmailCol = getColumnIndex(bookingHeaders, ['email', 'e-mail']);
    const bookingPhoneCol = getColumnIndex(bookingHeaders, ['phone', 'telephone', 'mobile']);
    const bookingNameCol = getColumnIndex(bookingHeaders, ['name', 'customer', 'client']);
    const bookingAddressCol = getColumnIndex(bookingHeaders, ['address', 'street', 'location']);
    const bookingVehicleCol = getColumnIndex(bookingHeaders, ['vehicle', 'car', 'auto']);
    
    if (nameCol < 0 || emailCol < 0) {
      return ContentService
        .createTextOutput(JSON.stringify({ success: false, message: 'Customer sheet must have Name and Email columns' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    if (bookingEmailCol < 0) {
      return ContentService
        .createTextOutput(JSON.stringify({ success: false, message: 'Booking sheet must have an Email column to sync customers' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // Get existing emails
    const existingEmails = new Set(
      existingCustomers.map(row => {
        const email = emailCol >= 0 ? (row[emailCol] || '').toString() : '';
        return email.toLowerCase();
      }).filter(Boolean)
    );
    
    const newCustomers = [];
    const seenEmails = new Set();
    
    // Process bookings - now using flexible column detection
    for (const booking of bookingRows) {
      const email = bookingEmailCol >= 0 ? (booking[bookingEmailCol] || '').toString() : '';
      const phone = bookingPhoneCol >= 0 ? (booking[bookingPhoneCol] || '').toString() : '';
      const customerName = bookingNameCol >= 0 ? (booking[bookingNameCol] || '').toString() : '';
      const address = bookingAddressCol >= 0 ? (booking[bookingAddressCol] || '').toString() : '';
      const vehicle = bookingVehicleCol >= 0 ? (booking[bookingVehicleCol] || '').toString() : '';
      
      if (email && !existingEmails.has(email.toLowerCase()) && !seenEmails.has(email.toLowerCase())) {
        seenEmails.add(email.toLowerCase());
        
        const maxColumns = customerHeaders.length;
        const newRow = new Array(maxColumns).fill('');
        
        const currentDate = new Date().toISOString().split('T')[0];
        
        if (nameCol >= 0) newRow[nameCol] = customerName || email.split('@')[0];
        if (emailCol >= 0) newRow[emailCol] = email;
        if (phoneCol >= 0) newRow[phoneCol] = phone;
        if (addressCol >= 0) newRow[addressCol] = address;
        if (vehicleCol >= 0) newRow[vehicleCol] = vehicle;
        if (notesCol >= 0) newRow[notesCol] = 'Auto-added from booking';
        if (dateCol >= 0) newRow[dateCol] = currentDate;
        
        newCustomers.push(newRow);
      }
    }
    
    // Add new customers
    if (newCustomers.length > 0) {
      const range = customerSheet.getRange(customerSheet.getLastRow() + 1, 1, newCustomers.length, customerHeaders.length);
      range.setValues(newCustomers);
    }
    
    return ContentService
      .createTextOutput(JSON.stringify({ 
        success: true, 
        message: `Synced ${newCustomers.length} new customers from bookings`,
        newCustomersCount: newCustomers.length,
        debugInfo: {
          totalBookings: bookingRows.length,
          bookingEmailColumn: bookingEmailCol,
          bookingPhoneColumn: bookingPhoneCol,
          bookingNameColumn: bookingNameCol,
          customerEmailColumn: emailCol,
          existingCustomersCount: existingCustomers.length
        }
      }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    console.error('Error in syncCustomersFromBookings:', error);
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
