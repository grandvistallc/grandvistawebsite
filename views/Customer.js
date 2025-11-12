// @ts-nocheck
// Utility to parse CSV (handles quoted fields with commas and newlines)
function parseCSV(text) {
	// First, split into rows respecting quotes (don't split on newlines inside quotes)
	const rows = [];
	let currentRow = '';
	let inQuotes = false;
	
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (char === '"') {
			inQuotes = !inQuotes;
			currentRow += char;
		} else if (char === '\n' && !inQuotes) {
			if (currentRow.trim() !== '') {
				rows.push(currentRow);
			}
			currentRow = '';
		} else if (char === '\r') {
			// Skip carriage returns
			continue;
		} else {
			currentRow += char;
		}
	}
	if (currentRow.trim() !== '') {
		rows.push(currentRow);
	}
	
	// Parse a single row (line)
	function parseLine(line) {
		const values = [];
		let current = '';
		let inQuotes = false;
		for (let i = 0; i < line.length; i++) {
			const char = line[i];
			if (char === '"') {
				inQuotes = !inQuotes;
			} else if (char === ',' && !inQuotes) {
				values.push(current.trim());
				current = '';
			} else {
				current += char;
			}
		}
		values.push(current.trim());
		return values;
	}
	
	if (rows.length === 0) return [];
	
	const headers = parseLine(rows[0]);
	return rows.slice(1).map(row => {
		const values = parseLine(row);
		const obj = {};
		headers.forEach((h, i) => obj[h] = values[i] || '');
		return obj;
	});
}

// Load CSV file
async function loadCustomers() {
	const response = await fetch('customer-import-template.csv');
	const text = await response.text();
	return parseCSV(text);
}

// Helper: get customers due for service (months since last service)
function getDueCustomers(customers, monthsThreshold) {
	const now = new Date();
	// Group by customer using consistent key
	const lastService = {};
	const customerNames = {}; // Store customer name for each key
	customers.forEach(c => {
		// Use consistent deduplication key
		const key = getCustomerKey(c);
		if (!customerNames[key]) {
			customerNames[key] = c['Customer'] || c['First Name'] + ' ' + c['Last Name'];
		}
		if (c['Date']) {
			// Parse date - handle formats like "7/8/24", "2025-09-29", etc.
			let d = null;
			let dateStr = c['Date'].trim();
			
			// Try ISO format first (YYYY-MM-DD)
			d = new Date(dateStr);
			
			// If that didn't work, try M/D/YY format
			if (isNaN(d) && dateStr.includes('/')) {
				const parts = dateStr.split('/');
				if (parts.length === 3) {
					let month = parseInt(parts[0]);
					let day = parseInt(parts[1]);
					let year = parseInt(parts[2]);
					// Handle 2-digit years
					if (year < 100) {
						year = year < 50 ? 2000 + year : 1900 + year;
					}
					d = new Date(year, month - 1, day);
				}
			}
			
			if (d && !isNaN(d)) {
				if (!lastService[key] || d > lastService[key]) {
					lastService[key] = d;
				}
			}
		}
	});
	// Find those with last service > specified months ago
	const due = [];
	Object.entries(lastService).forEach(([key, date]) => {
		const diffMonths = (now - date) / (1000 * 60 * 60 * 24 * 30.44);
		if (diffMonths >= monthsThreshold) {
			due.push({ 
				key: customerNames[key], 
				contactKey: key,  // Store the key for matching
				lastService: date 
			});
		}
	});
	return due;
}

// Helper: get top spending customers
function getTopSpenders(customers, topN = 10) {
	const spendingMap = new Map();
	
	customers.forEach(c => {
		// Only count entries with actual bookings (Date and Price)
		if (!c['Date'] || !c['Price']) return;
		
		const name = (c['Customer'] || '').trim();
		// Remove $ and commas from price before parsing
		const priceStr = (c['Price'] || '0').toString().replace(/[$,]/g, '');
		const price = parseFloat(priceStr) || 0;
		
		// Use consistent deduplication key
		const key = getCustomerKey(c);
		
		if (!spendingMap.has(key)) {
			spendingMap.set(key, {
				name: name,
				email: c['Email'] || '',
				phone: c['Number'] || '',
				totalSpent: 0,
				bookingCount: 0,
				bookings: [],
				customerKey: key  // Store the key for later lookup
			});
		}
		
		const entry = spendingMap.get(key);
		entry.totalSpent += price;
		entry.bookingCount += 1;
		entry.bookings.push(c);
	});
	
	// Convert to array and sort by total spent
	const spenders = Array.from(spendingMap.values());
	spenders.sort((a, b) => b.totalSpent - a.totalSpent);
	
	return spenders.slice(0, topN);
}

// Render search box and results
async function renderDashboard() {
	let customers = await loadCustomers();
	const container = document.getElementById('customer-dashboard');
	container.innerHTML = `
		<!-- Modern Search Bar -->
		<div style="
			background: linear-gradient(145deg, #ffffff 0%, #f8f9fa 100%);
			border-radius: 20px;
			padding: 24px;
			margin-bottom: 30px;
			box-shadow: 0 8px 30px rgba(0,0,0,0.12);
		">
			<div style="position: relative;">
				<span style="
					position: absolute;
					left: 20px;
					top: 30%;
					transform: translateY(-50%);
					font-size: 22px;
					pointer-events: none;
					display: flex;
					align-items: center;
					line-height: 1;
				">🔍</span>
				<input type="text" id="search-box" placeholder="Search by name, email, or phone..." style="
					width: 100%;
					padding: 18px 24px 18px 56px;
					border: 2px solid #e9ecef;
					border-radius: 16px;
					font-size: 16px;
					transition: all 0.3s ease;
					box-sizing: border-box;
					background: white;
					font-weight: 500;
					color: #2c3e50;
				" onfocus="this.style.borderColor='#667eea'; this.style.boxShadow='0 0 0 4px rgba(102, 126, 234, 0.1)';" 
				   onblur="this.style.borderColor='#e9ecef'; this.style.boxShadow='none';" />
			</div>
			<div id="search-results"></div>
		</div>
		
		<div id="customer-details"></div>
		
		<!-- Statistics Dashboard with Modern Cards -->
		<div style="
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
			gap: 24px;
			margin-bottom: 40px;
		" id="stats-dashboard" class="stats-dashboard">
			<!-- Total Customers -->
			<div style="
				background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
				border-radius: 20px;
				padding: 28px;
				box-shadow: 0 8px 30px rgba(102, 126, 234, 0.3);
				transition: transform 0.3s ease, box-shadow 0.3s ease;
				cursor: pointer;
				position: relative;
				overflow: hidden;
			" onmouseover="this.style.transform='translateY(-8px)'; this.style.boxShadow='0 12px 40px rgba(102, 126, 234, 0.4)';" 
			   onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 8px 30px rgba(102, 126, 234, 0.3)';">
				<div style="position: absolute; top: -30px; right: -30px; width: 120px; height: 120px; background: rgba(255,255,255,0.1); border-radius: 50%; filter: blur(40px);"></div>
				<div style="font-size: 42px; margin-bottom: 12px; position: relative;">👥</div>
				<div style="font-size: 42px; font-weight: 800; color: white; margin-bottom: 8px; position: relative;" id="total-customers">0</div>
				<div style="font-size: 14px; color: rgba(255,255,255,0.9); font-weight: 600; text-transform: uppercase; letter-spacing: 1px; position: relative;">Total Customers</div>
			</div>
			
			<!-- Total Bookings -->
			<div style="
				background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
				border-radius: 20px;
				padding: 28px;
				box-shadow: 0 8px 30px rgba(240, 147, 251, 0.3);
				transition: transform 0.3s ease, box-shadow 0.3s ease;
				cursor: pointer;
				position: relative;
				overflow: hidden;
			" onmouseover="this.style.transform='translateY(-8px)'; this.style.boxShadow='0 12px 40px rgba(240, 147, 251, 0.4)';" 
			   onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 8px 30px rgba(240, 147, 251, 0.3)';">
				<div style="position: absolute; top: -30px; right: -30px; width: 120px; height: 120px; background: rgba(255,255,255,0.1); border-radius: 50%; filter: blur(40px);"></div>
				<div style="font-size: 42px; margin-bottom: 12px; position: relative;">📅</div>
				<div style="font-size: 42px; font-weight: 800; color: white; margin-bottom: 8px; position: relative;" id="total-bookings">0</div>
				<div style="font-size: 14px; color: rgba(255,255,255,0.9); font-weight: 600; text-transform: uppercase; letter-spacing: 1px; position: relative;">Total Bookings</div>
			</div>
			
			<!-- Bookings This Month -->
			<div style="
				background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
				border-radius: 20px;
				padding: 28px;
				box-shadow: 0 8px 30px rgba(79, 172, 254, 0.3);
				transition: transform 0.3s ease, box-shadow 0.3s ease;
				cursor: pointer;
				position: relative;
				overflow: hidden;
			" onmouseover="this.style.transform='translateY(-8px)'; this.style.boxShadow='0 12px 40px rgba(79, 172, 254, 0.4)';" 
			   onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 8px 30px rgba(79, 172, 254, 0.3)';">
				<div style="position: absolute; top: -30px; right: -30px; width: 120px; height: 120px; background: rgba(255,255,255,0.1); border-radius: 50%; filter: blur(40px);"></div>
				<div style="font-size: 42px; margin-bottom: 12px; position: relative;">📆</div>
				<div style="font-size: 42px; font-weight: 800; color: white; margin-bottom: 8px; position: relative;" id="customers-this-month">0</div>
				<div style="font-size: 14px; color: rgba(255,255,255,0.9); font-weight: 600; text-transform: uppercase; letter-spacing: 1px; position: relative;">Bookings This Month</div>
			</div>
			
			<!-- Bookings This Year -->
			<div style="
				background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);
				border-radius: 20px;
				padding: 28px;
				box-shadow: 0 8px 30px rgba(67, 233, 123, 0.3);
				transition: transform 0.3s ease, box-shadow 0.3s ease;
				cursor: pointer;
				position: relative;
				overflow: hidden;
			" onmouseover="this.style.transform='translateY(-8px)'; this.style.boxShadow='0 12px 40px rgba(67, 233, 123, 0.4)';" 
			   onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 8px 30px rgba(67, 233, 123, 0.3)';">
				<div style="position: absolute; top: -30px; right: -30px; width: 120px; height: 120px; background: rgba(255,255,255,0.1); border-radius: 50%; filter: blur(40px);"></div>
				<div style="font-size: 42px; margin-bottom: 12px; position: relative;">🗓️</div>
				<div style="font-size: 42px; font-weight: 800; color: white; margin-bottom: 8px; position: relative;" id="customers-this-year">0</div>
				<div style="font-size: 14px; color: rgba(255,255,255,0.9); font-weight: 600; text-transform: uppercase; letter-spacing: 1px; position: relative;">Bookings This Year</div>
			</div>
			
			<!-- Top Customer Month -->
			<div style="
				background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);
				border-radius: 20px;
				padding: 28px;
				box-shadow: 0 8px 30px rgba(250, 112, 154, 0.3);
				transition: transform 0.3s ease, box-shadow 0.3s ease;
				cursor: pointer;
				position: relative;
				overflow: hidden;
			" onmouseover="this.style.transform='translateY(-8px)'; this.style.boxShadow='0 12px 40px rgba(250, 112, 154, 0.4)';" 
			   onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 8px 30px rgba(250, 112, 154, 0.3)';">
				<div style="position: absolute; top: -30px; right: -30px; width: 120px; height: 120px; background: rgba(255,255,255,0.1); border-radius: 50%; filter: blur(40px);"></div>
				<div style="font-size: 42px; margin-bottom: 12px; position: relative;">🏆</div>
				<div style="font-size: 20px; font-weight: 700; color: white; margin-bottom: 8px; position: relative; line-height: 1.2; min-height: 48px; display: flex; align-items: center;" id="top-customer-month">—</div>
				<div style="font-size: 14px; color: rgba(255,255,255,0.9); font-weight: 600; text-transform: uppercase; letter-spacing: 1px; position: relative;">Top Customer (Month)</div>
			</div>
			
			<!-- Top Customer Year -->
			<div style="
				background: linear-gradient(135deg, #fbc2eb 0%, #a6c1ee 100%);
				border-radius: 20px;
				padding: 28px;
				box-shadow: 0 8px 30px rgba(251, 194, 235, 0.3);
				transition: transform 0.3s ease, box-shadow 0.3s ease;
				cursor: pointer;
				position: relative;
				overflow: hidden;
			" onmouseover="this.style.transform='translateY(-8px)'; this.style.boxShadow='0 12px 40px rgba(251, 194, 235, 0.4)';" 
			   onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 8px 30px rgba(251, 194, 235, 0.3)';">
				<div style="position: absolute; top: -30px; right: -30px; width: 120px; height: 120px; background: rgba(255,255,255,0.1); border-radius: 50%; filter: blur(40px);"></div>
				<div style="font-size: 42px; margin-bottom: 12px; position: relative;">👑</div>
				<div style="font-size: 20px; font-weight: 700; color: white; margin-bottom: 8px; position: relative; line-height: 1.2; min-height: 48px; display: flex; align-items: center;" id="top-customer-year">—</div>
				<div style="font-size: 14px; color: rgba(255,255,255,0.9); font-weight: 600; text-transform: uppercase; letter-spacing: 1px; position: relative;">Top Customer (Year)</div>
			</div>
		</div>
		
		<!-- Collapsible Sections with Modern Styling -->
		<div id="due-customers-section" style="
			background: white;
			border-radius: 20px;
			padding: 28px;
			margin-bottom: 24px;
			box-shadow: 0 4px 20px rgba(0,0,0,0.08);
		">
			<h2 class="due-title" style="
				cursor: pointer;
				user-select: none;
				margin: 0;
				font-size: 22px;
				font-weight: 700;
				color: #2c3e50;
				display: flex;
				align-items: center;
				gap: 12px;
				padding: 12px 0;
				transition: color 0.3s ease;
			" onclick="toggleSection('due-customers-6months')" onmouseover="this.style.color='#667eea';" onmouseout="this.style.color='#2c3e50';">
				<span id="arrow-6months" style="font-size: 18px; transition: transform 0.3s ease;">▼</span>
				<span style="font-size: 28px;">⏰</span>
				Customers Due for Service (6+ Months)
			</h2>
			<div id="due-customers-6months" style="padding-top: 20px;"></div>
		</div>
		
		<div id="due-customers-section" style="
			background: white;
			border-radius: 20px;
			padding: 28px;
			margin-bottom: 24px;
			box-shadow: 0 4px 20px rgba(0,0,0,0.08);
		">
			<h2 class="due-title" style="
				cursor: pointer;
				user-select: none;
				margin: 0;
				font-size: 22px;
				font-weight: 700;
				color: #2c3e50;
				display: flex;
				align-items: center;
				gap: 12px;
				padding: 12px 0;
				transition: color 0.3s ease;
			" onclick="toggleSection('due-customers-12months')" onmouseover="this.style.color='#e74c3c';" onmouseout="this.style.color='#2c3e50';">
				<span id="arrow-12months" style="font-size: 18px; transition: transform 0.3s ease;">▼</span>
				<span style="font-size: 28px;">🚨</span>
				Customers Due for Service (12+ Months)
			</h2>
			<div id="due-customers-12months" style="padding-top: 20px;"></div>
		</div>
		
		<div id="top-spenders-section" style="
			background: white;
			border-radius: 20px;
			padding: 28px;
			margin-bottom: 24px;
			box-shadow: 0 4px 20px rgba(0,0,0,0.08);
		">
			<h2 class="due-title" style="
				cursor: pointer;
				user-select: none;
				margin: 0;
				font-size: 22px;
				font-weight: 700;
				color: #2c3e50;
				display: flex;
				align-items: center;
				gap: 12px;
				padding: 12px 0;
				transition: color 0.3s ease;
			" onclick="toggleSection('top-spenders')" onmouseover="this.style.color='#27ae60';" onmouseout="this.style.color='#2c3e50';">
				<span id="arrow-top-spenders" style="font-size: 18px; transition: transform 0.3s ease;">▼</span>
				<span style="font-size: 28px;">💎</span>
				Top 10 Customers by Total Spending
			</h2>
			<div id="top-spenders" style="padding-top: 20px;"></div>
		</div>
		
		<div id="returning-customers-section" style="
			background: white;
			border-radius: 20px;
			padding: 28px;
			margin-bottom: 24px;
			box-shadow: 0 4px 20px rgba(0,0,0,0.08);
		">
			<h2 class="due-title" style="
				cursor: pointer;
				user-select: none;
				margin: 0;
				font-size: 22px;
				font-weight: 700;
				color: #2c3e50;
				display: flex;
				align-items: center;
				gap: 12px;
				padding: 12px 0;
				transition: color 0.3s ease;
			" onclick="toggleSection('returning-customers-chart')" onmouseover="this.style.color='#3498db';" onmouseout="this.style.color='#2c3e50';">
				<span id="arrow-returning-customers" style="font-size: 18px; transition: transform 0.3s ease;">▼</span>
				<span style="font-size: 28px;">🔄</span>
				Returning Customers by Bookings
			</h2>
			<div id="returning-customers-chart" style="padding-top: 20px;"></div>
		</div>
		
		<div id="demographics-section" style="
			background: white;
			border-radius: 20px;
			padding: 28px;
			margin-bottom: 24px;
			box-shadow: 0 4px 20px rgba(0,0,0,0.08);
		">
			<h2 class="due-title" style="
				cursor: pointer;
				user-select: none;
				margin: 0;
				font-size: 22px;
				font-weight: 700;
				color: #2c3e50;
				display: flex;
				align-items: center;
				gap: 12px;
				padding: 12px 0;
				transition: color 0.3s ease;
			" onclick="toggleSection('demographics-charts')" onmouseover="this.style.color='#8b5cf6';" onmouseout="this.style.color='#2c3e50';">
				<span id="arrow-demographics" style="font-size: 18px; transition: transform 0.3s ease;">▼</span>
				<span style="font-size: 28px;">📊</span>
				Customer Demographics
			</h2>
			<div id="demographics-charts" style="padding-top: 20px;"></div>
		</div>
	`;
	
	// Create FAB button outside the container
	const fab = document.createElement('button');
	fab.id = 'add-customer-fab';
	fab.title = 'Add New Customer';
	fab.innerHTML = `
		<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<line x1="12" y1="5" x2="12" y2="19"></line>
			<line x1="5" y1="12" x2="19" y2="12"></line>
		</svg>
	`;
	document.body.appendChild(fab);
	
	const searchBox = document.getElementById('search-box');
	const resultsDiv = document.getElementById('search-results');
	const detailsDiv = document.getElementById('customer-details');
	
	// Add click handler for FAB button
	fab.addEventListener('click', () => {
		showAddCustomerForm();
	});

	searchBox.addEventListener('input', async function() {
		customers = await loadCustomers(); // Always reload latest CSV
		const query = this.value.trim().toLowerCase();
		let matches = [];
		if (query.length === 0) {
			resultsDiv.innerHTML = '';
			return;
		}
		// Fuzzy search by first name, last name, email, or phone
		matches = customers.filter(c => {
			const first = (c['Customer'] || '').toLowerCase();
			const email = (c['Email'] || '').toLowerCase();
			const phone = (c['Number'] || '').toLowerCase();
			return first.includes(query) || email.includes(query) || phone.includes(query);
		});
		
		// Group by unique customer and keep the most recent/complete entry
		const uniqueCustomers = new Map();
		matches.forEach(c => {
			const key = getCustomerKey(c);
			if (!uniqueCustomers.has(key)) {
				uniqueCustomers.set(key, c);
			} else {
				// Keep the entry with more information (email > phone > address)
				const existing = uniqueCustomers.get(key);
				if (!existing['Email'] && c['Email']) {
					uniqueCustomers.set(key, c);
				} else if (!existing['Number'] && c['Number']) {
					uniqueCustomers.set(key, c);
				} else if (!existing['Address'] && c['Address']) {
					uniqueCustomers.set(key, c);
				}
			}
		});
		
		matches = Array.from(uniqueCustomers.values());
		
		// Sort by best match (startsWith first, then includes)
		matches.sort((a, b) => {
			const fields = ['Customer', 'Email', 'Number'];
			for (let f of fields) {
				const qa = (a[f] || '').toLowerCase();
				const qb = (b[f] || '').toLowerCase();
				const startsA = qa.startsWith(query);
				const startsB = qb.startsWith(query);
				if (startsA && !startsB) return -1;
				if (!startsA && startsB) return 1;
			}
			return 0;
		});
		
		// Store unique matches for click handling
		window.searchMatches = matches;
		
		resultsDiv.innerHTML = matches.slice(0, 7).map((c, idx) =>
			`<div class="customer-result smooth-result" data-match-idx="${idx}">
				<span class="result-avatar">${(c['Customer']?.charAt(0) || 'C')}</span>
				<span class="result-name">${c['Customer'] || 'Unknown'}</span>
				<span class="result-email">${c['Email'] || ''}</span>
				<span class="result-phone">${c['Number'] || ''}</span>
			</div>`
		).join('');
	});

	resultsDiv.addEventListener('click', function(e) {
		let target = e.target;
		while (target && !target.classList.contains('customer-result')) {
			target = target.parentElement;
		}
		if (target && target.classList.contains('customer-result')) {
			const idx = target.getAttribute('data-match-idx');
			const customer = window.searchMatches[idx];
			displayCustomerDetails(customer, customers);
		}
	});
	
	// Function to display customer details (made global for reuse)
	window.displayCustomerDetails = function(customer, allCustomers) {
		// Create modal overlay
		const modal = document.createElement('div');
		modal.className = 'customer-profile-modal';
		modal.style.cssText = `
			position: fixed;
			top: 0;
			left: 0;
			width: 100%;
			height: 100%;
			background: rgba(0, 0, 0, 0.7);
			backdrop-filter: blur(10px);
			-webkit-backdrop-filter: blur(10px);
			display: flex;
			align-items: center;
			justify-content: center;
			z-index: 9999;
			animation: fadeIn 0.3s ease-out;
			overflow-y: auto;
			padding: 20px;
			box-sizing: border-box;
		`;
		
		// Find all bookings for this customer using consistent key matching
		const customerKey = getCustomerKey(customer);
		const bookings = allCustomers.filter(c => {
			return getCustomerKey(c) === customerKey && c['Date'] && c['Date'].trim() !== '';
		});
			const dates = bookings.map(b => {
				// Try to parse YYYY-MM-DD or MM/DD/YYYY
				let raw = b['Date'].trim();
				let d = new Date(raw);
				if (isNaN(d)) {
					// Try MM/DD/YYYY
					const parts = raw.split('/');
					if (parts.length === 3) {
						d = new Date(parts[2], parts[0] - 1, parts[1]);
					}
				}
				return d;
			}).filter(d => !isNaN(d)).sort((a, b) => b - a);
			const mostRecent = dates[0];
			const now = new Date();
			let monthsSince = '';
			if (mostRecent) {
				monthsSince = ((now - mostRecent) / (1000 * 60 * 60 * 24 * 30.44)).toFixed(1);
			}
			
			// Calculate total money spent
			let totalSpent = 0;
			bookings.forEach(b => {
				if (b['Price']) {
					// Remove $ and commas, then parse as float
					const price = parseFloat(String(b['Price']).replace(/[$,]/g, ''));
					if (!isNaN(price)) {
						totalSpent += price;
					}
				}
			});			
		// Fields to hide from main display
		const hiddenFields = ['Job ID', 'Date', 'Package', 'Size', 'Add-ons', 'Price', 'Time', 'End-Time', 'Status', 'Crew', 'Time Taken', 'Miles', ' Miles', 'Miles ', '  Miles  ', 'Demographics', '', ' ', '  '];
		const displayFields = Object.entries(customer)
			.filter(([key, value]) => !hiddenFields.includes(key) && key.trim() !== '' && !key.startsWith('Demo_'))
			.map(([key, value]) => [key, value]);
		
		// Parse location from address if available
		let locationData = { city: '', region: '', zip: '' };
		if (customer['Address']) {
			// Expected format: "123 Street Name, City, ST 12345"
			const addressParts = customer['Address'].split(',');
			if (addressParts.length >= 3) {
				locationData.city = addressParts[1].trim();
				// Parse region and ZIP from last part (e.g., "MN 55038")
				const lastPart = addressParts[2].trim().split(' ');
				if (lastPart.length >= 2) {
					locationData.region = lastPart[0];
					locationData.zip = lastPart[1];
				}
			}
		}
		
		// Parse existing demographics if available
		let existingDemo = { age: '', gender: '', city: locationData.city, region: locationData.region, zip: locationData.zip, income: '', occupation: '', education: '' };
		
		// First try to load from Demographics JSON field
		if (customer['Demographics']) {
			try {
				const parsed = JSON.parse(customer['Demographics']);
				existingDemo = { ...existingDemo, ...parsed };
			} catch (e) {
				console.log('Could not parse Demographics JSON:', e);
			}
		}
		
		// Then override with individual CSV columns if they exist (they take priority)
		if (customer['Demo_Age']) existingDemo.age = customer['Demo_Age'];
		if (customer['Demo_Gender']) existingDemo.gender = customer['Demo_Gender'];
		if (customer['Demo_City']) existingDemo.city = customer['Demo_City'];
		if (customer['Demo_Region']) existingDemo.region = customer['Demo_Region'];
		if (customer['Demo_ZIP']) existingDemo.zip = customer['Demo_ZIP'];
		if (customer['Demo_Income']) existingDemo.income = customer['Demo_Income'];
		if (customer['Demo_Occupation']) existingDemo.occupation = customer['Demo_Occupation'];
		if (customer['Demo_Education']) existingDemo.education = customer['Demo_Education'];
		
		modal.innerHTML = `
			<div class="customer-card" style="
				position: relative;
				background: linear-gradient(145deg, #ffffff 0%, #f8f9fa 100%);
				border-radius: 24px;
				max-width: 900px;
				width: 90%;
				max-height: 90vh;
				overflow-y: auto;
				box-shadow: 0 20px 60px rgba(0,0,0,0.3);
				padding: 0;
			">
				<!-- Close Button -->
				<span class="close-customer-btn" style="
					position: absolute;
					top: 20px;
					right: 20px;
					font-size: 28px;
					cursor: pointer;
					color: #95a5a6;
					font-weight: 300;
					z-index: 10;
					width: 36px;
					height: 36px;
					display: flex;
					align-items: center;
					justify-content: center;
					border-radius: 50%;
					transition: all 0.3s ease;
					background: rgba(255,255,255,0.8);
				" onmouseover="this.style.background='#e74c3c'; this.style.color='white'; this.style.transform='rotate(90deg)';" 
				   onmouseout="this.style.background='rgba(255,255,255,0.8)'; this.style.color='#95a5a6'; this.style.transform='rotate(0deg)';">
					&times;
				</span>
				
				<!-- Edit Button -->
				<button class="edit-customer-btn" style="
					position: absolute;
					top: 20px;
					right: 70px;
					background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
					color: white;
					border: none;
					padding: 10px 24px;
					border-radius: 12px;
					cursor: pointer;
					font-weight: 600;
					font-size: 14px;
					z-index: 10;
					box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
					transition: all 0.3s ease;
					letter-spacing: 0.5px;
				" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 20px rgba(102, 126, 234, 0.6)';" 
				   onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 15px rgba(102, 126, 234, 0.4)';">
					✏️ Edit
				</button>
				
				<!-- Header Section with Gradient Background -->
				<div style="
					background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
					padding: 40px 40px 100px 40px;
					border-radius: 24px 24px 0 0;
					position: relative;
					overflow: hidden;
				">
					<!-- Decorative Elements -->
					<div style="position: absolute; top: -50px; right: -50px; width: 200px; height: 200px; background: rgba(255,255,255,0.1); border-radius: 50%; filter: blur(40px);"></div>
					<div style="position: absolute; bottom: -30px; left: -30px; width: 150px; height: 150px; background: rgba(255,255,255,0.1); border-radius: 50%; filter: blur(30px);"></div>
					
					<div style="position: relative; z-index: 1;">
						<div class="customer-avatar" style="
							width: 90px;
							height: 90px;
							border-radius: 50%;
							background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
							display: flex;
							align-items: center;
							justify-content: center;
							font-size: 36px;
							font-weight: bold;
							color: white;
							margin: 0 auto 20px auto;
							box-shadow: 0 8px 30px rgba(0,0,0,0.3);
							border: 4px solid rgba(255,255,255,0.3);
						">
							<span>${(customer['Customer']?.charAt(0) || 'C')}</span>
						</div>
						<h2 style="
							color: white;
							font-size: 32px;
							font-weight: 700;
							margin: 0;
							text-align: center;
							text-shadow: 0 2px 10px rgba(0,0,0,0.2);
							letter-spacing: 0.5px;
						">${customer['Customer'] || 'Unknown Customer'}</h2>
					</div>
				</div>
				
				<!-- Stats Cards Section -->
				<div style="
					display: grid;
					grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
					gap: 20px;
					padding: 0 40px;
					margin-top: -60px;
					position: relative;
					z-index: 2;
					margin-bottom: 30px;
				">
					<!-- Total Spent Card -->
					<div style="
						background: white;
						border-radius: 16px;
						padding: 24px;
						box-shadow: 0 4px 20px rgba(0,0,0,0.1);
						text-align: center;
						border-left: 4px solid #27ae60;
						transition: transform 0.3s ease;
					" onmouseover="this.style.transform='translateY(-5px)'" onmouseout="this.style.transform='translateY(0)'">
						<div style="color: #27ae60; font-size: 36px; margin-bottom: 8px;">💰</div>
						<div style="font-size: 28px; font-weight: 700; color: #27ae60; margin-bottom: 4px;">$${totalSpent.toFixed(2)}</div>
						<div style="font-size: 13px; color: #7f8c8d; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">Total Spent</div>
					</div>
					
					<!-- Total Bookings Card -->
					<div style="
						background: white;
						border-radius: 16px;
						padding: 24px;
						box-shadow: 0 4px 20px rgba(0,0,0,0.1);
						text-align: center;
						border-left: 4px solid #3498db;
						transition: transform 0.3s ease;
					" onmouseover="this.style.transform='translateY(-5px)'" onmouseout="this.style.transform='translateY(0)'">
						<div style="color: #3498db; font-size: 36px; margin-bottom: 8px;">📅</div>
						<div style="font-size: 28px; font-weight: 700; color: #3498db; margin-bottom: 4px;">${bookings.length}</div>
						<div style="font-size: 13px; color: #7f8c8d; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">Total Bookings</div>
					</div>
					
					<!-- Last Service Card -->
					<div style="
						background: white;
						border-radius: 16px;
						padding: 24px;
						box-shadow: 0 4px 20px rgba(0,0,0,0.1);
						text-align: center;
						border-left: 4px solid #e67e22;
						transition: transform 0.3s ease;
					" onmouseover="this.style.transform='translateY(-5px)'" onmouseout="this.style.transform='translateY(0)'">
						<div style="color: #e67e22; font-size: 36px; margin-bottom: 8px;">🕐</div>
						<div style="font-size: 18px; font-weight: 700; color: #e67e22; margin-bottom: 4px;">${monthsSince ? monthsSince + ' months' : 'N/A'}</div>
						<div style="font-size: 13px; color: #7f8c8d; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">Since Last Service</div>
					</div>
				</div>
				
				<!-- Main Content Section -->
				<div style="padding: 0 40px 40px 40px;">
					<!-- Contact Information Section -->
					${displayFields.length > 0 ? `
					<div style="
						background: white;
						border-radius: 16px;
						padding: 28px;
						margin-bottom: 20px;
						box-shadow: 0 2px 15px rgba(0,0,0,0.08);
					">
						<h3 style="
							color: #2c3e50;
							font-size: 18px;
							font-weight: 700;
							margin: 0 0 20px 0;
							display: flex;
							align-items: center;
							gap: 10px;
						">
							<span style="font-size: 24px;">📞</span> Contact Information
						</h3>
						<div style="display: grid; gap: 16px;">
							${displayFields.map(([key, value]) => `
								<div style="
									display: flex;
									justify-content: space-between;
									align-items: center;
									padding: 12px 16px;
									background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
									border-radius: 10px;
									border-left: 3px solid #667eea;
								">
									<span style="font-weight: 600; color: #34495e; font-size: 14px;">${key}</span>
									<span style="color: #2c3e50; font-size: 14px; font-weight: 500;">${value || '—'}</span>
								</div>
							`).join('')}
						</div>
					</div>
					` : ''}
					
					<!-- Demographics Section -->
					${(existingDemo.age || existingDemo.gender || existingDemo.income || existingDemo.occupation || existingDemo.education) ? `
					<div style="
						background: white;
						border-radius: 16px;
						padding: 28px;
						margin-bottom: 20px;
						box-shadow: 0 2px 15px rgba(0,0,0,0.08);
					">
						<h3 style="
							color: #2c3e50;
							font-size: 18px;
							font-weight: 700;
							margin: 0 0 20px 0;
							display: flex;
							align-items: center;
							gap: 10px;
						">
							<span style="font-size: 24px;">👤</span> Demographics
						</h3>
						<div style="display: grid; gap: 16px;">
							${existingDemo.age ? `
								<div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 10px; border-left: 3px solid #8b5cf6;">
									<span style="font-weight: 600; color: #34495e; font-size: 14px;">Age</span>
									<span style="color: #2c3e50; font-size: 14px; font-weight: 500;">${existingDemo.age}</span>
								</div>
							` : ''}
							${existingDemo.gender ? `
								<div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 10px; border-left: 3px solid #8b5cf6;">
									<span style="font-weight: 600; color: #34495e; font-size: 14px;">Gender</span>
									<span style="color: #2c3e50; font-size: 14px; font-weight: 500;">${existingDemo.gender}</span>
								</div>
							` : ''}
							${existingDemo.city ? `
								<div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 10px; border-left: 3px solid #8b5cf6;">
									<span style="font-weight: 600; color: #34495e; font-size: 14px;">City</span>
									<span style="color: #2c3e50; font-size: 14px; font-weight: 500;">${existingDemo.city}</span>
								</div>
							` : ''}
							${existingDemo.region ? `
								<div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 10px; border-left: 3px solid #8b5cf6;">
									<span style="font-weight: 600; color: #34495e; font-size: 14px;">Region</span>
									<span style="color: #2c3e50; font-size: 14px; font-weight: 500;">${existingDemo.region}</span>
								</div>
							` : ''}
							${existingDemo.zip ? `
								<div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 10px; border-left: 3px solid #8b5cf6;">
									<span style="font-weight: 600; color: #34495e; font-size: 14px;">ZIP Code</span>
									<span style="color: #2c3e50; font-size: 14px; font-weight: 500;">${existingDemo.zip}</span>
								</div>
							` : ''}
							${existingDemo.income ? `
								<div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 10px; border-left: 3px solid #8b5cf6;">
									<span style="font-weight: 600; color: #34495e; font-size: 14px;">Income</span>
									<span style="color: #2c3e50; font-size: 14px; font-weight: 500;">${existingDemo.income}</span>
								</div>
							` : ''}
							${existingDemo.occupation ? `
								<div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 10px; border-left: 3px solid #8b5cf6;">
									<span style="font-weight: 600; color: #34495e; font-size: 14px;">Occupation</span>
									<span style="color: #2c3e50; font-size: 14px; font-weight: 500;">${existingDemo.occupation}</span>
								</div>
							` : ''}
							${existingDemo.education ? `
								<div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 10px; border-left: 3px solid #8b5cf6;">
									<span style="font-weight: 600; color: #34495e; font-size: 14px;">Education</span>
									<span style="color: #2c3e50; font-size: 14px; font-weight: 500;">${existingDemo.education}</span>
								</div>
							` : ''}
						</div>
					</div>
					` : ''}
					
					<!-- Booking History Section -->
					${bookings.length > 0 ? `
					<div style="
						background: white;
						border-radius: 16px;
						padding: 28px;
						box-shadow: 0 2px 15px rgba(0,0,0,0.08);
					">
						<h3 style="
							color: #2c3e50;
							font-size: 18px;
							font-weight: 700;
							margin: 0 0 20px 0;
							display: flex;
							align-items: center;
							gap: 10px;
						">
							<span style="font-size: 24px;">📋</span> Recent Booking History
						</h3>
						<div style="display: grid; gap: 12px; max-height: 300px; overflow-y: auto; padding-right: 10px;">
							${bookings.slice(0, 10).map(b => `
								<div style="
									padding: 16px;
									background: linear-gradient(135deg, #ffeaa7 0%, #fdcb6e 100%);
									border-radius: 10px;
									border-left: 4px solid #f39c12;
									display: grid;
									grid-template-columns: auto 1fr auto;
									gap: 16px;
									align-items: center;
									transition: transform 0.2s ease;
								" onmouseover="this.style.transform='translateX(5px)'" onmouseout="this.style.transform='translateX(0)'">
									<div style="font-size: 24px;">📅</div>
									<div>
										<div style="font-weight: 700; color: #2c3e50; font-size: 14px; margin-bottom: 4px;">${b['Package'] || 'Service'}</div>
										<div style="font-size: 12px; color: #7f8c8d;">${b['Date'] || 'N/A'}</div>
									</div>
									<div style="font-weight: 700; color: #27ae60; font-size: 16px;">$${b['Price'] || '0'}</div>
								</div>
							`).join('')}
						</div>
						${bookings.length > 10 ? `
							<div style="text-align: center; margin-top: 16px; color: #7f8c8d; font-size: 13px; font-style: italic;">
								Showing 10 of ${bookings.length} bookings
							</div>
						` : ''}
					</div>
					` : ''}
					
					<!-- Show All Button -->
					<button class="show-all-btn" id="show-all-btn" style="
						width: 100%;
						margin-top: 20px;
						padding: 16px;
						background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
						color: white;
						border: none;
						border-radius: 12px;
						font-size: 15px;
						font-weight: 600;
						cursor: pointer;
						transition: all 0.3s ease;
						box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
						letter-spacing: 0.5px;
					" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 20px rgba(102, 126, 234, 0.6)';" 
					   onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 15px rgba(102, 126, 234, 0.4)';">
						📄 Show All Information
					</button>
				</div>
			</div>
		`;
			
			// Append modal to body
			document.body.appendChild(modal);
			
			// Add click handler for close button
			const closeBtn = modal.querySelector('.close-customer-btn');
			if (closeBtn) {
				closeBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					e.preventDefault();
					modal.remove();
				});
			}
			
			// Close when clicking outside the card
			modal.addEventListener('click', (e) => {
				if (e.target === modal) {
					modal.remove();
				}
			});
			
			// Add click handler for edit button
			const editBtn = modal.querySelector('.edit-customer-btn');
			if (editBtn) {
				editBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					e.preventDefault();
					enableEditMode(customer, displayFields, modal, allCustomers);
				});
			}
			
			// Add click handler for "Show All Information" button
			modal.querySelector('#show-all-btn').addEventListener('click', () => {
				const popup = document.createElement('div');
				popup.className = 'info-popup';
				
				// Create booking history with dates and prices
				let bookingHistory = '';
				if (bookings.length > 0) {
					bookingHistory = `
						<div class="customer-info-row" style="margin-top:20px; border-top: 2px solid #2193b0; padding-top:15px;">
							<span class="customer-info-label" style="font-size:1.1rem; color:#2193b0;">Booking History:</span>
						</div>`;
					bookings.forEach(b => {
						const bookingDate = b['Date'] || 'N/A';
						const bookingPrice = b['Price'] || 'N/A';
						const bookingPackage = b['Package'] || 'N/A';
						bookingHistory += `
							<div class="customer-info-row" style="padding-left:20px; border-left: 3px solid #27ae60; margin-left:10px; margin-bottom:10px;">
								<div><strong>Date:</strong> ${bookingDate}</div>
								<div><strong>Package:</strong> ${bookingPackage}</div>
								<div><strong>Price:</strong> <span style="color:#27ae60; font-weight:600;">${bookingPrice}</span></div>
							</div>`;
					});
				}
				
			
			popup.innerHTML = `
				<div class="info-popup-content">
					<span class="info-popup-close">&times;</span>
					<h3>Complete Customer Information</h3>
				<div class="info-popup-body">
					${Object.entries(customer).filter(([key, value]) => 
						!['Price', 'Add-ons', 'Size', 'Job ID', 'Status', 'Crew', 'Time', 'End-Time', 'Package', 'Demographics'].includes(key)
					).map(([key, value]) => {
						const displayKey = key.replace(/^Demo_/, '');
						return `<div class="customer-info-row"><span class="customer-info-label">${displayKey}:</span> <span>${value || 'N/A'}</span></div>`;
					}).join('')}
					${bookingHistory}
				</div>
				</div>
			`;
		document.body.appendChild(popup);
		// Close popup when clicking X or outside
		popup.querySelector('.info-popup-close').addEventListener('click', () => popup.remove());
		popup.addEventListener('click', (e) => {
			if (e.target === popup) popup.remove();
		});
	});
	}
}

// Function to enable edit mode for customer information
function enableEditMode(customer, displayFields, modal, allCustomers) {
	// Parse existing demographics
	let existingDemo = { age: '', gender: '', city: '', region: '', zip: '', income: '', occupation: '', education: '' };
	
	// First try to load from Demographics JSON field
	if (customer['Demographics']) {
		try {
			const parsed = JSON.parse(customer['Demographics']);
			existingDemo = { ...existingDemo, ...parsed };
		} catch (e) {
			console.log('Could not parse Demographics JSON:', e);
		}
	}
	
	// Override with individual CSV columns if they exist
	if (customer['Demo_Age']) existingDemo.age = customer['Demo_Age'];
	if (customer['Demo_Gender']) existingDemo.gender = customer['Demo_Gender'];
	if (customer['Demo_City']) existingDemo.city = customer['Demo_City'];
	if (customer['Demo_Region']) existingDemo.region = customer['Demo_Region'];
	if (customer['Demo_ZIP']) existingDemo.zip = customer['Demo_ZIP'];
	if (customer['Demo_Income']) existingDemo.income = customer['Demo_Income'];
	if (customer['Demo_Occupation']) existingDemo.occupation = customer['Demo_Occupation'];
	if (customer['Demo_Education']) existingDemo.education = customer['Demo_Education'];
	
	// Create modal overlay if it doesn't exist
	let editModal = modal;
	if (!editModal || !editModal.classList.contains('customer-profile-modal')) {
		editModal = document.createElement('div');
		editModal.className = 'customer-profile-modal';
		editModal.style.cssText = `
			position: fixed;
			top: 0;
			left: 0;
			width: 100%;
			height: 100%;
			background: rgba(0, 0, 0, 0.7);
			backdrop-filter: blur(10px);
			-webkit-backdrop-filter: blur(10px);
			display: flex;
			align-items: center;
			justify-content: center;
			z-index: 9999;
			animation: fadeIn 0.3s ease-out;
			overflow-y: auto;
			padding: 20px;
			box-sizing: border-box;
		`;
		document.body.appendChild(editModal);
	}
	
	// Create editable form with modern styling
	const formHTML = `
		<div class="customer-card" style="
			position: relative;
			background: linear-gradient(145deg, #ffffff 0%, #f8f9fa 100%);
			border-radius: 24px;
			max-width: 800px;
			width: 90%;
			max-height: 90vh;
			overflow-y: auto;
			box-shadow: 0 20px 60px rgba(0,0,0,0.3);
			padding: 0;
		">
			<span class="close-customer-btn" style="
				position: absolute;
				top: 20px;
				right: 20px;
				font-size: 28px;
				cursor: pointer;
				color: #95a5a6;
				font-weight: 300;
				z-index: 10;
				width: 36px;
				height: 36px;
				display: flex;
				align-items: center;
				justify-content: center;
				border-radius: 50%;
				transition: all 0.3s ease;
				background: rgba(255,255,255,0.8);
			" onmouseover="this.style.background='#e74c3c'; this.style.color='white'; this.style.transform='rotate(90deg)';" 
			   onmouseout="this.style.background='rgba(255,255,255,0.8)'; this.style.color='#95a5a6'; this.style.transform='rotate(0deg)';">
				&times;
			</span>
			
			<!-- Header -->
			<div style="
				background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
				padding: 40px;
				border-radius: 24px 24px 0 0;
			">
				<div class="customer-avatar" style="
					width: 80px;
					height: 80px;
					border-radius: 50%;
					background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
					display: flex;
					align-items: center;
					justify-content: center;
					font-size: 32px;
					font-weight: bold;
					color: white;
					margin: 0 auto 16px auto;
					box-shadow: 0 8px 30px rgba(0,0,0,0.3);
					border: 4px solid rgba(255,255,255,0.3);
				">
					<span>${(customer['Customer']?.charAt(0) || 'C')}</span>
				</div>
				<h2 style="
					color: white;
					font-size: 28px;
					font-weight: 700;
					margin: 0;
					text-align: center;
					text-shadow: 0 2px 10px rgba(0,0,0,0.2);
				">✏️ Editing: ${customer['Customer'] || 'Unknown'}</h2>
			</div>
			
			<div style="padding: 40px;">
				<form id="edit-customer-form">
					<!-- Contact Information -->
					<div style="
						background: white;
						border-radius: 16px;
						padding: 28px;
						margin-bottom: 24px;
						box-shadow: 0 2px 15px rgba(0,0,0,0.08);
					">
						<h3 style="
							color: #2c3e50;
							font-size: 18px;
							font-weight: 700;
							margin: 0 0 20px 0;
							display: flex;
							align-items: center;
							gap: 10px;
						">
							<span style="font-size: 24px;">📞</span> Contact Information
						</h3>
						${displayFields.map(([key, value]) => `
							<div style="margin-bottom: 16px;">
								<label style="
									display: block;
									font-weight: 600;
									color: #34495e;
									font-size: 14px;
									margin-bottom: 8px;
								">${key}</label>
								<input type="text" name="${key}" value="${value || ''}" style="
									width: 100%;
									padding: 12px 16px;
									border: 2px solid #e9ecef;
									border-radius: 10px;
									font-size: 14px;
									transition: all 0.3s ease;
									box-sizing: border-box;
								" onfocus="this.style.borderColor='#667eea'; this.style.boxShadow='0 0 0 3px rgba(102, 126, 234, 0.1)';" 
								   onblur="this.style.borderColor='#e9ecef'; this.style.boxShadow='none';">
							</div>
						`).join('')}
					</div>
					
					<!-- Demographics -->
					<div style="
						background: white;
						border-radius: 16px;
						padding: 28px;
						margin-bottom: 24px;
						box-shadow: 0 2px 15px rgba(0,0,0,0.08);
					">
						<h3 style="
							color: #2c3e50;
							font-size: 18px;
							font-weight: 700;
							margin: 0 0 20px 0;
							display: flex;
							align-items: center;
							gap: 10px;
						">
							<span style="font-size: 24px;">👤</span> Demographics
						</h3>
						
						<div style="margin-bottom: 16px;">
							<label style="display: block; font-weight: 600; color: #34495e; font-size: 14px; margin-bottom: 8px;">Age</label>
							<input type="text" name="Demo_Age" value="${existingDemo.age || ''}" style="
								width: 100%;
								padding: 12px 16px;
								border: 2px solid #e9ecef;
								border-radius: 10px;
								font-size: 14px;
								transition: all 0.3s ease;
								box-sizing: border-box;
							" onfocus="this.style.borderColor='#8b5cf6'; this.style.boxShadow='0 0 0 3px rgba(139, 92, 246, 0.1)';" 
							   onblur="this.style.borderColor='#e9ecef'; this.style.boxShadow='none';">
						</div>
						
						<div style="margin-bottom: 16px;">
							<label style="display: block; font-weight: 600; color: #34495e; font-size: 14px; margin-bottom: 8px;">Gender</label>
							<select name="Demo_Gender" style="
								width: 100%;
								padding: 12px 16px;
								border: 2px solid #e9ecef;
								border-radius: 10px;
								font-size: 14px;
								transition: all 0.3s ease;
								box-sizing: border-box;
								background: white;
							" onfocus="this.style.borderColor='#8b5cf6'; this.style.boxShadow='0 0 0 3px rgba(139, 92, 246, 0.1)';" 
							   onblur="this.style.borderColor='#e9ecef'; this.style.boxShadow='none';">
								<option value="">Select...</option>
								<option value="Male" ${existingDemo.gender === 'Male' ? 'selected' : ''}>Male</option>
								<option value="Female" ${existingDemo.gender === 'Female' ? 'selected' : ''}>Female</option>
								<option value="Business" ${existingDemo.gender === 'Business' ? 'selected' : ''}>Business</option>
							</select>
						</div>
						
						<div style="margin-bottom: 16px;">
							<label style="display: block; font-weight: 600; color: #34495e; font-size: 14px; margin-bottom: 8px;">City</label>
							<input type="text" name="Demo_City" value="${existingDemo.city || ''}" style="
								width: 100%;
								padding: 12px 16px;
								border: 2px solid #e9ecef;
								border-radius: 10px;
								font-size: 14px;
								transition: all 0.3s ease;
								box-sizing: border-box;
							" onfocus="this.style.borderColor='#8b5cf6'; this.style.boxShadow='0 0 0 3px rgba(139, 92, 246, 0.1)';" 
							   onblur="this.style.borderColor='#e9ecef'; this.style.boxShadow='none';">
						</div>
						
						<div style="margin-bottom: 16px;">
							<label style="display: block; font-weight: 600; color: #34495e; font-size: 14px; margin-bottom: 8px;">Region/State</label>
							<input type="text" name="Demo_Region" value="${existingDemo.region || ''}" style="
								width: 100%;
								padding: 12px 16px;
								border: 2px solid #e9ecef;
								border-radius: 10px;
								font-size: 14px;
								transition: all 0.3s ease;
								box-sizing: border-box;
							" onfocus="this.style.borderColor='#8b5cf6'; this.style.boxShadow='0 0 0 3px rgba(139, 92, 246, 0.1)';" 
							   onblur="this.style.borderColor='#e9ecef'; this.style.boxShadow='none';">
						</div>
						
						<div style="margin-bottom: 16px;">
							<label style="display: block; font-weight: 600; color: #34495e; font-size: 14px; margin-bottom: 8px;">ZIP Code</label>
							<input type="text" name="Demo_ZIP" value="${existingDemo.zip || ''}" style="
								width: 100%;
								padding: 12px 16px;
								border: 2px solid #e9ecef;
								border-radius: 10px;
								font-size: 14px;
								transition: all 0.3s ease;
								box-sizing: border-box;
							" onfocus="this.style.borderColor='#8b5cf6'; this.style.boxShadow='0 0 0 3px rgba(139, 92, 246, 0.1)';" 
							   onblur="this.style.borderColor='#e9ecef'; this.style.boxShadow='none';">
						</div>
						
						<div style="margin-bottom: 16px;">
							<label style="display: block; font-weight: 600; color: #34495e; font-size: 14px; margin-bottom: 8px;">Income</label>
							<input type="text" name="Demo_Income" value="${existingDemo.income || ''}" style="
								width: 100%;
								padding: 12px 16px;
								border: 2px solid #e9ecef;
								border-radius: 10px;
								font-size: 14px;
								transition: all 0.3s ease;
								box-sizing: border-box;
							" onfocus="this.style.borderColor='#8b5cf6'; this.style.boxShadow='0 0 0 3px rgba(139, 92, 246, 0.1)';" 
							   onblur="this.style.borderColor='#e9ecef'; this.style.boxShadow='none';">
						</div>
						
						<div style="margin-bottom: 16px;">
							<label style="display: block; font-weight: 600; color: #34495e; font-size: 14px; margin-bottom: 8px;">Occupation</label>
							<input type="text" name="Demo_Occupation" value="${existingDemo.occupation || ''}" style="
								width: 100%;
								padding: 12px 16px;
								border: 2px solid #e9ecef;
								border-radius: 10px;
								font-size: 14px;
								transition: all 0.3s ease;
								box-sizing: border-box;
							" onfocus="this.style.borderColor='#8b5cf6'; this.style.boxShadow='0 0 0 3px rgba(139, 92, 246, 0.1)';" 
							   onblur="this.style.borderColor='#e9ecef'; this.style.boxShadow='none';">
						</div>
						
						<div style="margin-bottom: 0;">
							<label style="display: block; font-weight: 600; color: #34495e; font-size: 14px; margin-bottom: 8px;">Education</label>
							<input type="text" name="Demo_Education" value="${existingDemo.education || ''}" style="
								width: 100%;
								padding: 12px 16px;
								border: 2px solid #e9ecef;
								border-radius: 10px;
								font-size: 14px;
								transition: all 0.3s ease;
								box-sizing: border-box;
							" onfocus="this.style.borderColor='#8b5cf6'; this.style.boxShadow='0 0 0 3px rgba(139, 92, 246, 0.1)';" 
							   onblur="this.style.borderColor='#e9ecef'; this.style.boxShadow='none';">
						</div>
					</div>
					
					<!-- Action Buttons -->
					<div style="display: flex; gap: 12px;">
						<button type="submit" style="
							flex: 1;
							background: linear-gradient(135deg, #27ae60 0%, #229954 100%);
							color: white;
							border: none;
							padding: 16px;
							border-radius: 12px;
							cursor: pointer;
							font-weight: 700;
							font-size: 15px;
							box-shadow: 0 4px 15px rgba(39, 174, 96, 0.4);
							transition: all 0.3s ease;
							letter-spacing: 0.5px;
						" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 20px rgba(39, 174, 96, 0.6)';" 
						   onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 15px rgba(39, 174, 96, 0.4)';">
							💾 Save Changes
						</button>
						<button type="button" id="cancel-edit-btn" style="
							flex: 1;
							background: linear-gradient(135deg, #95a5a6 0%, #7f8c8d 100%);
							color: white;
							border: none;
							padding: 16px;
							border-radius: 12px;
							cursor: pointer;
							font-weight: 700;
							font-size: 15px;
							box-shadow: 0 4px 15px rgba(149, 165, 166, 0.4);
							transition: all 0.3s ease;
							letter-spacing: 0.5px;
						" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 20px rgba(149, 165, 166, 0.6)';" 
						   onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 15px rgba(149, 165, 166, 0.4)';">
							❌ Cancel
						</button>
					</div>
				</form>
			</div>
		</div>
	`;
	
	editModal.innerHTML = formHTML;
	
	// Add close button handler
	const closeBtn = editModal.querySelector('.close-customer-btn');
	if (closeBtn) {
		closeBtn.addEventListener('click', () => {
			editModal.remove();
		});
	}
	
	// Close when clicking outside
	editModal.addEventListener('click', (e) => {
		if (e.target === editModal) {
			editModal.remove();
		}
	});
	
	// Add cancel button handler
	editModal.querySelector('#cancel-edit-btn').addEventListener('click', () => {
		editModal.remove();
		displayCustomerDetails(customer, allCustomers);
	});
	
	// Add form submit handler
	editModal.querySelector('#edit-customer-form').addEventListener('submit', async (e) => {
		e.preventDefault();
		
		// Get form data
		const formData = new FormData(e.target);
		const updatedData = {};
		for (let [key, value] of formData.entries()) {
			updatedData[key] = value;
		}
		
		// Update the customer object in memory
		Object.assign(customer, updatedData);
		
		// Save to backend server
		try {
			const response = await fetch('http://localhost:5000/api/update-customer', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					identifier: customer['Email'] || customer['Customer'],
					fields: updatedData
				})
			});
			
			const result = await response.json();
			
			if (result.success) {
				alert(`✓ Changes saved successfully! Updated ${result.updated_count} record(s) in the CSV file.`);
			} else {
				alert(`✗ Error saving changes: ${result.message}`);
			}
		} catch (error) {
			alert(`✗ Could not connect to server. Make sure the server is running.\n\nError: ${error.message}\n\nChanges are saved in memory but not persisted to CSV.`);
		}
		
		// Close the edit modal and show updated profile
		editModal.remove();
		displayCustomerDetails(customer, allCustomers);
	});
}

// Show due customers for 6+ months
function renderDueCustomers6Months() {
	loadCustomers().then(customers => {
		// Update dashboard stats
		updateDashboardStats(customers);
		
		const due6 = getDueCustomers(customers, 6);
		const due12 = getDueCustomers(customers, 12);
		
		// Get list of customer keys that are in 12+ month category
		const due12Keys = new Set(due12.map(c => c.contactKey));
		
		// Filter out customers that are already in 12+ month category
		const due6Only = due6.filter(c => !due12Keys.has(c.contactKey));
		
		const dueList = document.getElementById('due-customers-6months');
		if (due6Only.length === 0) {
			dueList.innerHTML = '<p>No customers are due for service (6-12 months).</p>';
			return;
		}
		dueList.innerHTML = due6Only.map((c, idx) => {
			// Find customer using the contactKey (which is now from getCustomerKey)
			const customerData = customers.find(cust => getCustomerKey(cust) === c.contactKey);
			
			return `<div style="
				background: linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%);
				border-radius: 12px;
				padding: 18px;
				margin-bottom: 12px;
				box-shadow: 0 4px 15px rgba(252, 182, 159, 0.2);
				transition: transform 0.2s ease, box-shadow 0.2s ease;
				cursor: pointer;
				position: relative;
				overflow: hidden;
			" data-contact-key="${c.contactKey}"
			   onmouseover="this.style.transform='translateY(-3px)'; this.style.boxShadow='0 6px 20px rgba(252, 182, 159, 0.3)';"
			   onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 15px rgba(252, 182, 159, 0.2)';">
				<div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.2); border-radius: 50%; filter: blur(30px);"></div>
				<div style="position: relative; z-index: 1;">
					<div style="font-size: 16px; font-weight: 700; color: #8b4513; margin-bottom: 6px;">
						${c.key}
					</div>
					<div style="font-size: 13px; color: #a0522d; display: flex; align-items: center; gap: 6px;">
						<span style="font-size: 14px;">🕐</span>
						Last Service: ${c.lastService.toLocaleDateString()}
					</div>
				</div>
			</div>`;
		}).join('');
		
		// Add click handlers to open customer profile
		dueList.querySelectorAll('[data-contact-key]').forEach(elem => {
			elem.addEventListener('click', function() {
				const contactKey = this.getAttribute('data-contact-key');
				const customer = customers.find(cust => getCustomerKey(cust) === contactKey);
				if (customer) {
					// Trigger the same display logic as search results
					displayCustomerDetails(customer, customers);
				}
			});
		});
	});
}

// Show due customers for 12+ months
function renderDueCustomers12Months() {
	loadCustomers().then(customers => {
		const due = getDueCustomers(customers, 12);
		const dueList = document.getElementById('due-customers-12months');
		if (due.length === 0) {
			dueList.innerHTML = '<p>No customers are due for service.</p>';
			return;
		}
		dueList.innerHTML = due.map((c, idx) => {
			// Find customer using the contactKey (which is now from getCustomerKey)
			const customerData = customers.find(cust => getCustomerKey(cust) === c.contactKey);
			
			return `<div style="
				background: linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%);
				border-radius: 12px;
				padding: 18px;
				margin-bottom: 12px;
				box-shadow: 0 4px 15px rgba(255, 154, 158, 0.2);
				transition: transform 0.2s ease, box-shadow 0.2s ease;
				cursor: pointer;
				position: relative;
				overflow: hidden;
			" data-contact-key="${c.contactKey}"
			   onmouseover="this.style.transform='translateY(-3px)'; this.style.boxShadow='0 6px 20px rgba(255, 154, 158, 0.3)';"
			   onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 15px rgba(255, 154, 158, 0.2)';">
				<div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.3); border-radius: 50%; filter: blur(30px);"></div>
				<div style="position: relative; z-index: 1;">
					<div style="font-size: 16px; font-weight: 700; color: #c71585; margin-bottom: 6px;">
						${c.key}
					</div>
					<div style="font-size: 13px; color: #d63384; display: flex; align-items: center; gap: 6px;">
						<span style="font-size: 14px;">🚨</span>
						Last Service: ${c.lastService.toLocaleDateString()}
					</div>
				</div>
			</div>`;
		}).join('');
		
		// Add click handlers to open customer profile
		dueList.querySelectorAll('[data-contact-key]').forEach(elem => {
			elem.addEventListener('click', function() {
				const contactKey = this.getAttribute('data-contact-key');
				const customer = customers.find(cust => getCustomerKey(cust) === contactKey);
				if (customer) {
					// Trigger the same display logic as search results
					displayCustomerDetails(customer, customers);
				}
			});
		});
	});
}

// Show top 10 spending customers
function renderTopSpenders() {
	loadCustomers().then(customers => {
		const topSpenders = getTopSpenders(customers, 10);
		const spendersList = document.getElementById('top-spenders');
		
		if (topSpenders.length === 0) {
			spendersList.innerHTML = '<p>No customer data available.</p>';
			return;
		}
		
		spendersList.innerHTML = topSpenders.map((spender, idx) => {
			// Generate gradient colors based on ranking
			const gradients = [
				'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', // #1 - Pink
				'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', // #2 - Blue
				'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)', // #3 - Green
				'linear-gradient(135deg, #fa709a 0%, #fee140 100%)', // #4 - Pink-Yellow
				'linear-gradient(135deg, #30cfd0 0%, #330867 100%)', // #5 - Teal-Purple
				'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)', // #6 - Light Blue-Pink
				'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)', // #7 - Pink
				'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)', // #8 - Peach
				'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', // #9 - Purple
				'linear-gradient(135deg, #fbc2eb 0%, #a6c1ee 100%)'  // #10 - Pink-Blue
			];
			const gradient = gradients[idx] || gradients[0];
			
			return `<div style="
				background: ${gradient};
				border-radius: 12px;
				padding: 18px;
				margin-bottom: 12px;
				box-shadow: 0 4px 15px rgba(102, 126, 234, 0.2);
				transition: transform 0.2s ease, box-shadow 0.2s ease;
				cursor: pointer;
				position: relative;
				overflow: hidden;
			" data-contact-key="${spender.customerKey}"
			   onmouseover="this.style.transform='translateY(-3px)'; this.style.boxShadow='0 6px 20px rgba(102, 126, 234, 0.3)';"
			   onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 15px rgba(102, 126, 234, 0.2)';">
				<div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.2); border-radius: 50%; filter: blur(30px);"></div>
				<div style="position: relative; z-index: 1;">
					<div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
						<span style="font-size: 24px; line-height: 1;">${idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '💎'}</span>
						<div style="font-size: 16px; font-weight: 700; color: white;">
							#${idx + 1} - ${spender.name}
						</div>
					</div>
					<div style="font-size: 14px; color: rgba(255,255,255,0.95); display: flex; flex-wrap: wrap; gap: 12px; align-items: center;">
						<span style="display: flex; align-items: center; gap: 4px;">
							<span style="font-size: 16px;">💰</span>
							<strong>$${spender.totalSpent.toFixed(2)}</strong>
						</span>
						<span style="display: flex; align-items: center; gap: 4px;">
							<span style="font-size: 16px;">📅</span>
							${spender.bookingCount} booking${spender.bookingCount !== 1 ? 's' : ''}
						</span>
					</div>
				</div>
			</div>`;
		}).join('');
		
		// Add click handlers to open customer profile
		spendersList.querySelectorAll('[data-contact-key]').forEach(elem => {
			elem.addEventListener('click', function() {
				const contactKey = this.getAttribute('data-contact-key');
				const customer = customers.find(cust => getCustomerKey(cust) === contactKey);
				if (customer) {
					window.displayCustomerDetails(customer, customers);
				}
			});
		});
	});
}

// Show all bookings for a top spender
function showTopSpenderDetails(spender, allCustomers) {
	const modal = document.createElement('div');
	modal.className = 'customer-profile-modal';
	modal.style.cssText = `
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: rgba(0, 0, 0, 0.7);
		display: flex;
		justify-content: center;
		align-items: center;
		z-index: 10000;
		backdrop-filter: blur(10px);
		padding: 20px;
		box-sizing: border-box;
	`;
	
	const bookingListHTML = spender.bookings.map((booking, index) => `
		<div class="booking-group-customer" data-booking-index="${index}" style="cursor: pointer; user-select: none;">
			<div style="pointer-events: none;">
				<strong style="display: block;">${booking.Customer || 'Unknown'}</strong>
				<div style="font-size: 13px; color: #667eea; margin-top: 4px;">
					${booking.Date ? `${booking.Date}` : ''}
					${booking.Package ? ` • ${booking.Package}` : ''}
					${booking.Service ? ` • ${booking.Service}` : ''}
					${booking.Price ? ` • $${booking.Price}` : ''}
				</div>
			</div>
		</div>
	`).join('');
	
	modal.innerHTML = `
		<div class="customer-card" onclick="event.stopPropagation()" style="max-width: 600px; width: 100%; max-height: 70vh; overflow-y: auto; margin: auto; pointer-events: auto; position: relative; z-index: 10001;">
			<div style="margin-bottom: 20px; pointer-events: none;">
				<h3 style="margin: 0;">${spender.name}</h3>
			</div>
			<p style="margin-bottom: 15px; color: #10b981; font-size: 1.2rem; font-weight: 700; pointer-events: none;">Total Spent: $${spender.totalSpent.toFixed(2)}</p>
			<p style="margin-bottom: 15px; color: #666; pointer-events: none;">${spender.bookingCount} booking${spender.bookingCount !== 1 ? 's' : ''}</p>
			<div class="booking-group-list" style="position: relative; z-index: 10002;">
				${bookingListHTML}
			</div>
		</div>
	`;
	
	// Close on outside click
	modal.addEventListener('click', function(e) {
		if (e.target === modal) {
			modal.remove();
		}
	});
	
	document.body.appendChild(modal);
	
	// Add click handlers to each booking to open full profile
	modal.querySelectorAll('.booking-group-customer').forEach((elem, index) => {
		elem.addEventListener('click', function(e) {
			e.stopPropagation();
			const booking = spender.bookings[index];
			if (booking) {
				modal.remove();
				window.displayCustomerDetails(booking, allCustomers);
			}
		});
	});
}

// Helper function to get unique customer identifier
function getCustomerKey(customer) {
	const email = (customer.Email || '').toLowerCase().trim();
	const phone = (customer.Number || '').replace(/\D/g, '').trim();
	const name = (customer.Customer || '').toLowerCase().trim();
	const address = (customer.Address || '').toLowerCase().trim();
	
	// Priority: email > phone+name > name+address > name only
	if (email) return 'email:' + email;
	if (phone && name) return 'phone:' + phone + ':' + name;
	if (name && address) return 'nameaddr:' + name + '|' + address;
	return 'name:' + name;
}

// Calculate dashboard statistics
function calculateDashboardStats(customers) {
	const now = new Date();
	const currentMonth = now.getMonth();
	const currentYear = now.getFullYear();
	
	// Track customers and spending by month and year
	const monthCustomers = new Map();
	const yearCustomers = new Map();
	const allTimeCustomers = new Map();
	const monthSpending = new Map();
	const yearSpending = new Map();
	
	let totalBookingsAllTime = 0;
	let bookingsThisMonth = 0;
	let bookingsThisYear = 0;
	
	// First pass: Count ALL unique customers (including those without bookings)
	customers.forEach(customer => {
		const customerKey = getCustomerKey(customer);
		if (!allTimeCustomers.has(customerKey)) {
			allTimeCustomers.set(customerKey, customer.Customer);
		}
	});
	
	// Second pass: Count only actual bookings
	customers.forEach(customer => {
		// Only count entries with actual booking information
		if (!customer.Date || !customer.Price) return;
		
		totalBookingsAllTime++;
		
		const customerKey = getCustomerKey(customer);
		
		// Parse date - handle formats like "7/8/24", "2025-09-29", etc.
		let date = null;
		let dateStr = customer.Date.trim();
		
		// Try ISO format first (YYYY-MM-DD)
		date = new Date(dateStr);
		
		// If that didn't work, try M/D/YY or M/D/YYYY format
		if (isNaN(date) && dateStr.includes('/')) {
			const parts = dateStr.split('/');
			if (parts.length === 3) {
				let month = parseInt(parts[0]);
				let day = parseInt(parts[1]);
				let year = parseInt(parts[2]);
				// Handle 2-digit years
				if (year < 100) {
					year = year < 50 ? 2000 + year : 1900 + year;
				}
				date = new Date(year, month - 1, day);
			}
		}
		
		if (!date || isNaN(date)) return;
		
		// This month
		if (date.getMonth() === currentMonth && date.getFullYear() === currentYear) {
			bookingsThisMonth++;
			monthCustomers.set(customerKey, customer.Customer);
			const priceStr = String(customer.Price).replace(/[$,]/g, '');
			const spent = parseFloat(priceStr) || 0;
			monthSpending.set(customerKey, (monthSpending.get(customerKey) || 0) + spent);
		}
		
		// This year
		if (date.getFullYear() === currentYear) {
			bookingsThisYear++;
			yearCustomers.set(customerKey, customer.Customer);
			const priceStr = String(customer.Price).replace(/[$,]/g, '');
			const spent = parseFloat(priceStr) || 0;
			yearSpending.set(customerKey, (yearSpending.get(customerKey) || 0) + spent);
		}
	});
	
	// Find top customers
	let topMonthCustomer = '—';
	let topMonthSpent = 0;
	monthSpending.forEach((spent, key) => {
		if (spent > topMonthSpent) {
			topMonthSpent = spent;
			topMonthCustomer = monthCustomers.get(key);
		}
	});
	
	let topYearCustomer = '—';
	let topYearSpent = 0;
	yearSpending.forEach((spent, key) => {
		if (spent > topYearSpent) {
			topYearSpent = spent;
			topYearCustomer = yearCustomers.get(key);
		}
	});
	
	console.log('📊 Top Customer Calculation:');
	console.log('Year spending map size:', yearSpending.size);
	console.log('Year customers map size:', yearCustomers.size);
	console.log('Top year customer:', topYearCustomer, 'Spent:', topYearSpent);
	console.log('Top month customer:', topMonthCustomer, 'Spent:', topMonthSpent);
	console.log('Bookings this year:', bookingsThisYear);
	console.log('Bookings this month:', bookingsThisMonth);
	
	// Debug: Show all year spending
	if (yearSpending.size > 0) {
		console.log('All 2025 spending:');
		const sorted = Array.from(yearSpending.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
		sorted.forEach(([key, spent]) => {
			console.log(`  ${yearCustomers.get(key)}: $${spent.toFixed(2)}`);
		});
	}
	
	return {
		customersMonth: bookingsThisMonth,
		topCustomerMonth: topMonthCustomer,
		customersYear: bookingsThisYear,
		topCustomerYear: topYearCustomer,
		totalCustomers: allTimeCustomers.size,
		totalBookings: totalBookingsAllTime
	};
}

// Update dashboard stats display
function updateDashboardStats(customers) {
	const stats = calculateDashboardStats(customers);
	
	console.log('Dashboard Stats:', stats);
	console.log('Current date:', new Date());
	
	const totalCustomersElem = document.getElementById('total-customers');
	const totalBookingsElem = document.getElementById('total-bookings');
	const monthElem = document.getElementById('customers-this-month');
	const topMonthElem = document.getElementById('top-customer-month');
	const yearElem = document.getElementById('customers-this-year');
	const topYearElem = document.getElementById('top-customer-year');
	
	console.log('Elements found:', {totalCustomersElem, totalBookingsElem, monthElem, topMonthElem, yearElem, topYearElem});
	
	if (totalCustomersElem) {
		totalCustomersElem.textContent = stats.totalCustomers;
		const card = totalCustomersElem.parentElement;
		card.addEventListener('click', () => {
			showStatDetails(customers, 'allTime', stats);
		});
	}
	if (totalBookingsElem) {
		totalBookingsElem.textContent = stats.totalBookings;
		const card = totalBookingsElem.parentElement;
		card.addEventListener('click', () => {
			showStatDetails(customers, 'allBookings', stats);
		});
	}
	if (monthElem) {
		monthElem.textContent = stats.customersMonth;
		const card = monthElem.parentElement;
		card.addEventListener('click', () => {
			showStatDetails(customers, 'month', stats);
		});
	}
	if (topMonthElem) {
		topMonthElem.textContent = stats.topCustomerMonth;
		const card = topMonthElem.parentElement;
		card.addEventListener('click', () => {
			showStatDetails(customers, 'topMonth', stats);
		});
	}
	if (yearElem) {
		yearElem.textContent = stats.customersYear;
		const card = yearElem.parentElement;
		card.addEventListener('click', () => {
			showStatDetails(customers, 'year', stats);
		});
	}
	if (topYearElem) {
		topYearElem.textContent = stats.topCustomerYear;
		const card = topYearElem.parentElement;
		card.addEventListener('click', () => {
			showStatDetails(customers, 'topYear', stats);
		});
	}
}

// Show detailed popup for stat cards
function showStatDetails(customers, type, stats) {
	const now = new Date();
	const currentMonth = now.getMonth();
	const currentYear = now.getFullYear();
	
	let title = '';
	let customerList = [];
	
	if (type === 'allTime') {
		title = 'All Customers';
		const seen = new Set();
		customers.forEach(customer => {
			const customerKey = getCustomerKey(customer);
			if (!seen.has(customerKey)) {
				seen.add(customerKey);
				// Clean up customer name - remove trailing " -"
				let cleanName = (customer.Customer || 'Unknown').trim();
				if (cleanName.endsWith(' -')) {
					cleanName = cleanName.slice(0, -2).trim();
				}
				customerList.push({ key: customerKey, name: cleanName, customer });
			}
		});
		console.log('Popup allTime count:', customerList.length);
		console.log('Stat allTime count:', stats.totalCustomers);
	} else if (type === 'allBookings') {
		title = 'All Bookings';
		customers.forEach(customer => {
			// Filter out customers without booking information
			if (!customer.Date || !customer.Price) return;
			const date = parseDate(customer.Date);
			customerList.push({ name: customer.Customer || 'Unknown', customer, date: date || new Date(0) });
		});
		// Sort by date (oldest to newest - chronological)
		customerList.sort((a, b) => a.date - b.date);
	} else if (type === 'month') {
		title = 'Bookings This Month';
		customers.forEach(customer => {
			// Filter out customers without booking information
			if (!customer.Date || !customer.Price) return;
			const date = parseDate(customer.Date);
			if (date && date.getMonth() === currentMonth && date.getFullYear() === currentYear) {
				customerList.push({ name: customer.Customer || 'Unknown', customer, date: date });
			}
		});
		// Sort by date (oldest to newest - chronological)
		customerList.sort((a, b) => a.date - b.date);
	} else if (type === 'topMonth') {
		title = 'Top Customer This Month';
		if (stats.topCustomerMonth !== '—') {
			// Get the customer key for the top customer
			const topCustomer = customers.find(c => c.Customer === stats.topCustomerMonth);
			if (topCustomer) {
				const topCustomerKey = getCustomerKey(topCustomer);
				// Get all bookings for this customer this month
				const topCustomerBookings = customers.filter(c => {
					if (!c.Date) return false;
					const date = parseDate(c.Date);
					return getCustomerKey(c) === topCustomerKey && 
						   date && date.getMonth() === currentMonth && date.getFullYear() === currentYear;
				});
				if (topCustomerBookings.length > 0) {
					// Calculate total spent
					const totalSpent = topCustomerBookings.reduce((sum, b) => {
						const priceStr = String(b.Price || '0').replace(/[$,]/g, '');
						return sum + (parseFloat(priceStr) || 0);
					}, 0);
					customerList = topCustomerBookings.map(b => ({
						name: `${b.Customer} - $${b.Price || '0'} (${b.Date})`,
						customer: b,
						totalSpent: totalSpent
					}));
				}
			}
		}
	} else if (type === 'year') {
		title = 'Bookings This Year';
		customers.forEach(customer => {
			// Filter out customers without booking information
			if (!customer.Date || !customer.Price) return;
			const date = parseDate(customer.Date);
			if (date && date.getFullYear() === currentYear) {
				customerList.push({ name: customer.Customer || 'Unknown', customer, date: date });
			}
		});
		// Sort by date (oldest to newest - chronological)
		customerList.sort((a, b) => a.date - b.date);
	} else if (type === 'topYear') {
		title = 'Top Customer This Year';
		if (stats.topCustomerYear !== '—') {
			// Get the customer key for the top customer
			const topCustomer = customers.find(c => c.Customer === stats.topCustomerYear);
			if (topCustomer) {
				const topCustomerKey = getCustomerKey(topCustomer);
				// Get all bookings for this customer this year
				const topCustomerBookings = customers.filter(c => {
					if (!c.Date) return false;
					const date = parseDate(c.Date);
					return getCustomerKey(c) === topCustomerKey && 
						   date && date.getFullYear() === currentYear;
				});
				if (topCustomerBookings.length > 0) {
					// Calculate total spent
					const totalSpent = topCustomerBookings.reduce((sum, b) => {
						const priceStr = String(b.Price || '0').replace(/[$,]/g, '');
						return sum + (parseFloat(priceStr) || 0);
					}, 0);
					customerList = topCustomerBookings.map(b => ({
						name: `${b.Customer} - $${b.Price || '0'} (${b.Date})`,
						customer: b,
						totalSpent: totalSpent
					}));
				}
			}
		}
	}
	
	// Sort by name (except for date-sorted lists)
	if (type !== 'month' && type !== 'year' && type !== 'allBookings') {
		customerList.sort((a, b) => a.name.localeCompare(b.name));
	}
	
	// Create modal
	const modal = document.createElement('div');
	modal.className = 'customer-profile-modal';
	modal.style.cssText = `
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: rgba(0, 0, 0, 0.7);
		display: flex;
		justify-content: center;
		align-items: center;
		z-index: 10000;
		backdrop-filter: blur(10px);
		padding: 20px;
		box-sizing: border-box;
	`;
	
	const customerListHTML = customerList.map((item, index) => {
		// For "All Customers" view, show only names without booking details
		if (type === 'allTime') {
			return `
				<div class="booking-group-customer" data-customer-index="${index}" style="cursor: pointer; user-select: none;">
					<div style="pointer-events: none;">
						<strong style="display: block;">${item.name}</strong>
					</div>
				</div>
			`;
		}
		// For other views, show booking details
		return `
			<div class="booking-group-customer" data-customer-index="${index}" style="cursor: pointer; user-select: none;">
				<div style="pointer-events: none;">
					<strong style="display: block;">${item.name}</strong>
					<div style="font-size: 13px; color: #667eea; margin-top: 4px;">
						${item.customer && item.customer.Date ? `${item.customer.Date}` : ''}
						${item.customer && item.customer.Service ? ` • ${item.customer.Service}` : ''}
						${item.customer && item.customer.Price ? ` • $${item.customer.Price}` : ''}
					</div>
				</div>
			</div>
		`;
	}).join('');
	
	// Calculate total if this is a top customer view
	let totalSpentHeader = '';
	if ((type === 'topMonth' || type === 'topYear') && customerList.length > 0 && customerList[0].totalSpent) {
		totalSpentHeader = `<p style="margin-bottom: 15px; color: #10b981; font-size: 1.2rem; font-weight: 700; pointer-events: none;">Total Spent: $${customerList[0].totalSpent.toFixed(2)}</p>`;
	}
	
	modal.innerHTML = `
		<div class="customer-card" onclick="event.stopPropagation()" style="max-width: 600px; width: 100%; max-height: 70vh; overflow-y: auto; margin: auto; pointer-events: auto; position: relative; z-index: 10001;">
			<!-- Close Button -->
			<span class="close-stat-btn" style="
				position: absolute;
				top: 18px;
				right: 18px;
				width: 44px;
				height: 44px;
				display: flex;
				align-items: center;
				justify-content: center;
				border-radius: 50%;
				background: linear-gradient(135deg, #f8fafc 0%, #e9ecef 100%);
				box-shadow: 0 2px 12px rgba(44,62,80,0.10);
				cursor: pointer;
				z-index: 10;
				border: 1px solid #e0e6ed;
				transition: box-shadow 0.2s, background 0.2s, transform 0.2s;
			" onmouseover="this.style.background='linear-gradient(135deg, #e74c3c 0%, #e67e22 100%)'; this.style.boxShadow='0 4px 16px rgba(231,76,60,0.18)'; this.style.transform='scale(1.08) rotate(90deg)';" 
			   onmouseout="this.style.background='linear-gradient(135deg, #f8fafc 0%, #e9ecef 100%)'; this.style.boxShadow='0 2px 12px rgba(44,62,80,0.10)'; this.style.transform='scale(1) rotate(0deg)';">
				<svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
				  <circle cx="11" cy="11" r="10" fill="white"/>
				  <path d="M7 7L15 15M15 7L7 15" stroke="#e74c3c" stroke-width="2.2" stroke-linecap="round"/>
				</svg>
			</span>
			<div style="margin-bottom: 20px; pointer-events: none;">
				<h3 style="margin: 0;">${title}</h3>
			</div>
			${totalSpentHeader}
			<p style="margin-bottom: 15px; color: #666; pointer-events: none;">${customerList.length} booking${customerList.length !== 1 ? 's' : ''}</p>
			<div class="booking-group-list" style="position: relative; z-index: 10002;">
				${customerListHTML}
			</div>
		</div>
	`;
	
	// Close on outside click - add this BEFORE appending to DOM
	modal.addEventListener('click', function(e) {
		if (e.target === modal) {
			modal.remove();
		}
	});

	document.body.appendChild(modal);

	// Add click handler for close button
	const closeBtn = modal.querySelector('.close-stat-btn');
	if (closeBtn) {
		closeBtn.addEventListener('click', function(e) {
			e.stopPropagation();
			e.preventDefault();
			modal.remove();
		});
	}

	// Add click handlers to customer names AFTER appending
	modal.querySelectorAll('.booking-group-customer').forEach((elem, index) => {
		elem.addEventListener('click', function(e) {
			e.stopPropagation();
			e.preventDefault();
			console.log('Clicked stat customer index:', index);
			console.log('customerList:', customerList);
			const item = customerList[index];
			console.log('Customer item:', item);
			if (item && item.customer) {
				const customerData = item.customer;
				console.log('Customer data:', customerData);
				modal.remove();
				window.displayCustomerDetails(customerData, customers);
			} else {
				console.error('No customer data found for index:', index);
			}
		});
	});
}

// Helper function to parse dates
function parseDate(dateStr) {
	if (!dateStr) return null;
	let date = new Date(dateStr.trim());
	if (isNaN(date) && dateStr.includes('/')) {
		const parts = dateStr.split('/');
		if (parts.length === 3) {
			let month = parseInt(parts[0]);
			let day = parseInt(parts[1]);
			let year = parseInt(parts[2]);
			if (year < 100) {
				year = year < 50 ? 2000 + year : 1900 + year;
			}
			date = new Date(year, month - 1, day);
		}
	}
	return isNaN(date) ? null : date;
}

// Render returning customers pie chart
function renderReturningCustomersPieChart() {
	loadCustomers().then(customers => {
		// Get unique customers first
		const uniqueCustomersMap = new Map();
		customers.forEach(customer => {
			const key = getCustomerKey(customer);
			if (!uniqueCustomersMap.has(key)) {
				uniqueCustomersMap.set(key, customer);
			}
		});
		
		const allUniqueCustomers = Array.from(uniqueCustomersMap.values());
		
		// Count bookings per customer (only those with Date and Price)
		const customerBookings = {};
		
		customers.forEach(customer => {
			// Only count actual bookings (with Date and Price)
			if (!customer.Date || !customer.Price) return;
			
			const key = getCustomerKey(customer);
			const name = customer.Customer || 'Unknown';
			
			if (!customerBookings[key]) {
				customerBookings[key] = { name: name, count: 0, customer: customer };
			}
			customerBookings[key].count++;
		});
		
		// Add customers with 0 bookings (contacts without services)
		allUniqueCustomers.forEach(customer => {
			const key = getCustomerKey(customer);
			const name = customer.Customer || 'Unknown';
			
			if (!customerBookings[key]) {
				customerBookings[key] = { name: name, count: 0, customer: customer };
			}
		});
		
		// Group customers by booking count
		const bookingGroups = {};
		Object.values(customerBookings).forEach(customer => {
			const count = customer.count;
			if (!bookingGroups[count]) {
				bookingGroups[count] = 0;
			}
			bookingGroups[count]++;
		});
		
		// Convert to array and sort by booking count
		const chartData = Object.entries(bookingGroups)
			.map(([bookings, customerCount]) => ({
				bookings: parseInt(bookings),
				customerCount: customerCount
			}))
			.sort((a, b) => a.bookings - b.bookings);
		
		const chartContainer = document.getElementById('returning-customers-chart');
		
		if (chartData.length === 0) {
			chartContainer.innerHTML = '<p>No customer data found.</p>';
			return;
		}
		
		// Generate colors for pie chart
		const colors = [
			'#667eea', '#764ba2', '#f093fb', '#f5576c', '#4facfe', '#00f2fe',
			'#43e97b', '#38f9d7', '#fa709a', '#fee140', '#30cfd0', '#330867',
			'#a8edea', '#fed6e3', '#ff6e7f', '#bfe9ff', '#c471f5', '#fa71cd'
		];
		
		// Calculate total customers
		const totalCustomers = chartData.reduce((sum, item) => sum + item.customerCount, 0);
		
		// Create SVG pie chart
		let currentAngle = 0;
		const centerX = 200;
		const centerY = 200;
		const radius = 150;
		
		let svgPaths = '';
		let legendHTML = '';
		
		chartData.forEach((item, index) => {
			const percentage = (item.customerCount / totalCustomers) * 100;
			const sliceAngle = (item.customerCount / totalCustomers) * 360;
			
			// Calculate path for pie slice
			const startAngle = currentAngle;
			const endAngle = currentAngle + sliceAngle;
			
			const x1 = centerX + radius * Math.cos((startAngle - 90) * Math.PI / 180);
			const y1 = centerY + radius * Math.sin((startAngle - 90) * Math.PI / 180);
			const x2 = centerX + radius * Math.cos((endAngle - 90) * Math.PI / 180);
			const y2 = centerY + radius * Math.sin((endAngle - 90) * Math.PI / 180);
			
			const largeArcFlag = sliceAngle > 180 ? 1 : 0;
			
			const pathData = `M ${centerX},${centerY} L ${x1},${y1} A ${radius},${radius} 0 ${largeArcFlag},1 ${x2},${y2} Z`;
			
			const color = colors[index % colors.length];
			const bookingLabel = item.bookings === 0 ? '0 Bookings' : item.bookings === 1 ? '1 Booking' : `${item.bookings} Bookings`;
			svgPaths += `<path d="${pathData}" fill="${color}" stroke="white" stroke-width="2" class="pie-slice" data-bookings="${item.bookings}" data-count="${item.customerCount}"/>`;
			
			legendHTML += `
				<div class="legend-item" data-bookings="${item.bookings}" style="
					background: linear-gradient(135deg, ${color}22 0%, ${color}44 100%);
					border-left: 4px solid ${color};
					border-radius: 8px;
					padding: 12px 16px;
					margin-bottom: 10px;
					transition: transform 0.2s ease, box-shadow 0.2s ease;
					cursor: pointer;
				" onmouseover="this.style.transform='translateX(5px)'; this.style.boxShadow='0 4px 12px ${color}44';"
				   onmouseout="this.style.transform='translateX(0)'; this.style.boxShadow='none';">
					<div style="display: flex; align-items: center; gap: 12px;">
						<div style="
							width: 20px;
							height: 20px;
							border-radius: 50%;
							background-color: ${color};
							box-shadow: 0 2px 8px ${color}66;
							flex-shrink: 0;
						"></div>
						<div style="flex: 1;">
							<span style="font-weight: 700; color: #2c3e50; font-size: 15px;">${bookingLabel}</span>
							<span style="color: #7f8c8d; margin-left: 8px; font-size: 14px;">${item.customerCount} customers (${percentage.toFixed(1)}%)</span>
						</div>
					</div>
				</div>
			`;
			
			currentAngle = endAngle;
		});
		
		chartContainer.innerHTML = `
			<div class="pie-chart-container" style="width: 100%; max-width: 100vw; overflow-x: auto; box-sizing: border-box; margin: 0 auto; display: flex; flex-direction: column; align-items: center;">
				<svg viewBox="0 0 400 400" class="pie-chart-svg" style="width: 100%; max-width: 400px; height: auto; display: block;">
					${svgPaths}
				</svg>
				<div class="pie-chart-legend">
					${legendHTML}
				</div>
			</div>
		`;
		
		// Add click event to show customers in that booking group
		chartContainer.querySelectorAll('.pie-slice').forEach(slice => {
			slice.addEventListener('click', function() {
				const bookingCount = parseInt(this.getAttribute('data-bookings'));
				showCustomersInBookingGroup(customerBookings, bookingCount, customers);
			});
			
			slice.addEventListener('mouseenter', function() {
				this.style.opacity = '0.8';
				this.style.transform = 'scale(1.05)';
				this.style.transformOrigin = 'center';
				this.style.cursor = 'pointer';
			});
			slice.addEventListener('mouseleave', function() {
				this.style.opacity = '1';
				this.style.transform = 'scale(1)';
			});
		});
		
		// Add click event to legend items too
		chartContainer.querySelectorAll('.legend-item').forEach(item => {
			item.addEventListener('click', function() {
				const bookingCount = parseInt(this.getAttribute('data-bookings'));
				showCustomersInBookingGroup(customerBookings, bookingCount, customers);
			});
		});
	});
}

// Show customers in a specific booking group
function showCustomersInBookingGroup(customerBookings, bookingCount, allCustomers) {
	// Filter customers with this booking count
	const customersInGroup = Object.values(customerBookings)
		.filter(c => c.count === bookingCount)
		.sort((a, b) => a.name.localeCompare(b.name));
	
	const bookingLabel = bookingCount === 1 ? '1 Booking' : `${bookingCount} Bookings`;
	
	// Create modal popup
	const modal = document.createElement('div');
	modal.className = 'customer-profile-modal';
	modal.style.cssText = `
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: rgba(0, 0, 0, 0.7);
		display: flex;
		justify-content: center;
		align-items: center;
		z-index: 10000;
		backdrop-filter: blur(10px);
		padding: 20px;
		box-sizing: border-box;
	`;
	
	let customerListHTML = customersInGroup.map((customer, index) => `
		<div style="
			background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
			border-radius: 10px;
			padding: 16px;
			margin-bottom: 10px;
			box-shadow: 0 3px 12px rgba(102, 126, 234, 0.2);
			transition: transform 0.2s ease, box-shadow 0.2s ease;
			cursor: pointer;
			position: relative;
			overflow: hidden;
		" data-customer-index="${index}"
		   onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 5px 18px rgba(102, 126, 234, 0.3)';"
		   onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 3px 12px rgba(102, 126, 234, 0.2)';">
			<div style="position: absolute; top: -15px; right: -15px; width: 60px; height: 60px; background: rgba(255,255,255,0.2); border-radius: 50%; filter: blur(25px);"></div>
			<div style="position: relative; z-index: 1; font-size: 15px; font-weight: 600; color: white; pointer-events: none;">
				${customer.name}
			</div>
		</div>
	`).join('');
	
	modal.innerHTML = `
		<div class="customer-card" onclick="event.stopPropagation()" style="max-width: 600px; width: 100%; max-height: 70vh; overflow-y: auto; margin: auto; pointer-events: auto; position: relative; z-index: 10001;">
			<div style="margin-bottom: 20px; pointer-events: none;">
				<h3 style="margin: 0;">Customers with ${bookingLabel}</h3>
			</div>
			<p style="margin-bottom: 15px; color: #666; pointer-events: none;">Total: ${customersInGroup.length} customers</p>
			<div class="booking-group-list" style="position: relative; z-index: 10002;">
				${customerListHTML}
			</div>
		</div>
	`;
	
	// Close on outside click - add this BEFORE appending to DOM
	modal.addEventListener('click', function(e) {
		if (e.target === modal) {
			modal.remove();
		}
	});
	
	// Append modal to DOM
	document.body.appendChild(modal);
	
	// Add click handlers to customer names AFTER appending
	modal.querySelectorAll('[data-customer-index]').forEach((elem, index) => {
		elem.addEventListener('click', function(e) {
			e.stopPropagation();
			e.preventDefault();
			console.log('Clicked customer index:', index);
			console.log('customersInGroup:', customersInGroup);
			const item = customersInGroup[index];
			console.log('Customer item:', item);
			if (item && item.customer) {
				const customerData = item.customer;
				console.log('Customer data:', customerData);
				modal.remove();
				window.displayCustomerDetails(customerData, allCustomers);
			} else {
				console.error('No customer data found for index:', index);
			}
		});
	});
}

// Render Demographics Charts
async function renderDemographicsCharts() {
	const customers = await loadCustomers();
	
	// Get unique customers only (not multiple bookings)
	const uniqueCustomersMap = new Map();
	customers.forEach(customer => {
		const key = getCustomerKey(customer);
		if (!uniqueCustomersMap.has(key)) {
			uniqueCustomersMap.set(key, customer);
		} else {
			// Keep the entry with more demographic info
			const existing = uniqueCustomersMap.get(key);
			if (customer['Demo_Gender'] && !existing['Demo_Gender']) {
				uniqueCustomersMap.set(key, customer);
			}
		}
	});
	
	const uniqueCustomers = Array.from(uniqueCustomersMap.values());
	
	// Parse demographics data from unique customers AND build mapping in one pass
	const demographics = {
		age: {},
		gender: {},
		location: {},
		income: {},
		occupation: {},
		education: {}
	};
	
	// Store customer-to-demographic mapping for click handlers
	window.demographicCustomers = {
		age: {},
		gender: {},
		location: {},
		income: {},
		occupation: {},
		education: {}
	};
	
	let totalWithDemographics = 0;
	
	uniqueCustomers.forEach(customer => {
		let demo = {};
		let hasDemographics = false;
		
		// Try to load from Demographics JSON field first
		if (customer['Demographics']) {
			try {
				demo = JSON.parse(customer['Demographics']);
				hasDemographics = true;
			} catch (e) {
				console.log('Error parsing demographics:', e);
			}
		}
		
		// Override/supplement with individual CSV columns if they exist
		if (customer['Demo_Age']) {
			demo.age = customer['Demo_Age'];
			hasDemographics = true;
		}
		if (customer['Demo_Gender']) {
			demo.gender = customer['Demo_Gender'];
			hasDemographics = true;
		}
		if (customer['Demo_Region']) {
			demo.region = customer['Demo_Region'];
			hasDemographics = true;
		}
		if (customer['Demo_Income']) {
			demo.income = customer['Demo_Income'];
			hasDemographics = true;
		}
		if (customer['Demo_Occupation']) {
			demo.occupation = customer['Demo_Occupation'];
			hasDemographics = true;
		}
		if (customer['Demo_Education']) {
			demo.education = customer['Demo_Education'];
			hasDemographics = true;
		}
		
		if (hasDemographics) {
			totalWithDemographics++;
			
			// Count age groups AND store customers
			if (demo.age) {
				const age = parseInt(demo.age);
				let ageGroup;
				if (age < 25) ageGroup = 'Under 25';
				else if (age < 35) ageGroup = '25-34';
				else if (age < 45) ageGroup = '35-44';
				else if (age < 55) ageGroup = '45-54';
				else if (age < 65) ageGroup = '55-64';
				else ageGroup = '65+';
				
				demographics.age[ageGroup] = (demographics.age[ageGroup] || 0) + 1;
				if (!window.demographicCustomers.age[ageGroup]) {
					window.demographicCustomers.age[ageGroup] = [];
				}
				window.demographicCustomers.age[ageGroup].push(customer);
			}
			
			// Count gender AND store customers
			if (demo.gender) {
				demographics.gender[demo.gender] = (demographics.gender[demo.gender] || 0) + 1;
				if (!window.demographicCustomers.gender[demo.gender]) {
					window.demographicCustomers.gender[demo.gender] = [];
				}
				window.demographicCustomers.gender[demo.gender].push(customer);
			}
			
			// Count location by region AND store customers
			if (demo.region) {
				demographics.location[demo.region] = (demographics.location[demo.region] || 0) + 1;
				if (!window.demographicCustomers.location[demo.region]) {
					window.demographicCustomers.location[demo.region] = [];
				}
				window.demographicCustomers.location[demo.region].push(customer);
			}
			
			// Count income levels AND store customers
			if (demo.income) {
				demographics.income[demo.income] = (demographics.income[demo.income] || 0) + 1;
				if (!window.demographicCustomers.income[demo.income]) {
					window.demographicCustomers.income[demo.income] = [];
				}
				window.demographicCustomers.income[demo.income].push(customer);
			}
			
			// Count occupations AND store customers
			if (demo.occupation) {
				demographics.occupation[demo.occupation] = (demographics.occupation[demo.occupation] || 0) + 1;
				if (!window.demographicCustomers.occupation[demo.occupation]) {
					window.demographicCustomers.occupation[demo.occupation] = [];
				}
				window.demographicCustomers.occupation[demo.occupation].push(customer);
			}
			
			// Count education levels AND store customers
			if (demo.education) {
				demographics.education[demo.education] = (demographics.education[demo.education] || 0) + 1;
				if (!window.demographicCustomers.education[demo.education]) {
					window.demographicCustomers.education[demo.education] = [];
				}
				window.demographicCustomers.education[demo.education].push(customer);
			}
		}
	});
	
	const chartContainer = document.getElementById('demographics-charts');
	
	if (totalWithDemographics === 0) {
		chartContainer.innerHTML = `
			<div style="padding: 20px; text-align: center; color: #94a3b8;">
				<p style="font-size: 1.1rem; margin-bottom: 10px;">No demographic data available yet.</p>
				<p>Open customer profiles and click "Demographics" to add demographic information.</p>
			</div>
		`;
		return;
	}
	
	// Generate charts
	const colors = ['#667eea', '#764ba2', '#f093fb', '#f5576c', '#4facfe', '#00f2fe', '#43e97b', '#38f9d7', '#fa709a', '#fee140'];
	
	let chartsHTML = `
		<div style="padding: 20px; background: rgba(139, 92, 246, 0.05); border-radius: 10px; margin-bottom: 20px;">
			<p style="color: #8b5cf6; font-size: 1.1rem; font-weight: 600;">
				📊 Demographics collected from ${totalWithDemographics} customer${totalWithDemographics !== 1 ? 's' : ''}
			</p>
		</div>
		<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 30px;">
	`;
	
	// Create bar chart for each demographic category
	const categories = [
		{ key: 'age', label: 'Age Distribution', icon: '👥' },
		{ key: 'gender', label: 'Gender Distribution', icon: '⚧' },
		{ key: 'location', label: 'Location by State', icon: '📍' },
		{ key: 'income', label: 'Income Levels', icon: '💰' },
		{ key: 'education', label: 'Education Levels', icon: '🎓' }
	];
	
	categories.forEach(category => {
		const data = demographics[category.key];
		const entries = Object.entries(data);
		
		if (entries.length === 0) return;
		
		// Sort by count descending
		entries.sort((a, b) => b[1] - a[1]);
		
		const maxCount = Math.max(...entries.map(e => e[1]));
		
		let barsHTML = entries.map(([label, count], index) => {
			const percentage = maxCount > 0 ? (count / maxCount) * 100 : 0;
			const color = colors[index % colors.length];
			
			return `
				<div style="margin-bottom: 15px;">
					<div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
						<span style="color: #e2e8f0; font-weight: 500;">${label}</span>
						<span style="color: #8b5cf6; font-weight: 600;">${count} (${((count/totalWithDemographics)*100).toFixed(1)}%)</span>
					</div>
					<div class="demo-bar" data-category="${category.key}" data-label="${label}" style="background: rgba(255,255,255,0.05); border-radius: 8px; height: 30px; overflow: hidden; position: relative; cursor: pointer; transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">
						<div style="background: linear-gradient(90deg, ${color}, ${color}dd); height: 100%; width: ${percentage}%; border-radius: 8px; transition: width 0.5s ease; display: flex; align-items: center; justify-content: flex-end; padding-right: 10px;">
							<span style="color: white; font-weight: 600; font-size: 0.9rem;"></span>
						</div>
					</div>
				</div>
			`;
		}).join('');
		
		chartsHTML += `
			<div style="background: rgba(30, 41, 59, 0.8); border: 2px solid #334155; border-radius: 10px; padding: 20px;">
				<h3 style="color: #8b5cf6; margin-top: 0; margin-bottom: 20px; font-size: 1.3rem;">
					${category.icon} ${category.label}
				</h3>
				${barsHTML}
			</div>
		`;
	});
	
	// Add occupation word cloud if we have occupation data
	const occupations = Object.entries(demographics.occupation);
	if (occupations.length > 0) {
		occupations.sort((a, b) => b[1] - a[1]);
		const top10 = occupations.slice(0, 10);
		
		let occupationHTML = top10.map(([occupation, count], index) => {
			const fontSize = 1.4 - (index * 0.08);
			const color = colors[index % colors.length];
			return `
				<span style="color: ${color}; font-size: ${fontSize}rem; margin: 10px; display: inline-block; font-weight: 600;">
					${occupation} (${count})
				</span>
			`;
		}).join('');
		
		chartsHTML += `
			<div style="background: rgba(30, 41, 59, 0.8); border: 2px solid #334155; border-radius: 10px; padding: 20px; grid-column: span 1;">
				<h3 style="color: #8b5cf6; margin-top: 0; margin-bottom: 20px; font-size: 1.3rem;">
					💼 Top Occupations
				</h3>
				<div style="text-align: center; padding: 20px;">
					${occupationHTML}
				</div>
			</div>
		`;
	}
	
	chartsHTML += '</div>';
	
	chartContainer.innerHTML = chartsHTML;
	
	// Add click handlers to demographic bars
	document.querySelectorAll('.demo-bar').forEach(bar => {
		bar.addEventListener('click', function() {
			const category = this.getAttribute('data-category');
			const label = this.getAttribute('data-label');
			const customerList = window.demographicCustomers[category][label] || [];
			
			showDemographicCustomerList(category, label, customerList, customers);
		});
	});
}

// Function to show customer list for a demographic category
function showDemographicCustomerList(category, label, customerList, allCustomers) {
	const categoryNames = {
		age: 'Age',
		gender: 'Gender',
		location: 'Location',
		income: 'Income',
		occupation: 'Occupation',
		education: 'Education'
	};
	
	const categoryIcons = {
		age: '👥',
		gender: '⚧',
		location: '📍',
		income: '💰',
		occupation: '💼',
		education: '🎓'
	};
	
	// Enhanced popup for Gender category
	if (category === 'gender') {
		// Calculate statistics using ALL bookings from allCustomers
		const totalSpending = {};
		const avgSpending = {};
		const bookingCounts = {};
		
		// First, build a map of customer keys from the unique customer list
		const customerKeys = new Set();
		customerList.forEach(customer => {
			customerKeys.add(getCustomerKey(customer));
		});
		
		// Now find ALL bookings for these customers
		allCustomers.forEach(booking => {
			const bookingKey = getCustomerKey(booking);
			if (customerKeys.has(bookingKey)) {
				const name = booking['Customer'] || 'Unknown';
				if (!totalSpending[bookingKey]) {
					totalSpending[bookingKey] = 0;
					bookingCounts[bookingKey] = 0;
				}
				
				// Only count actual bookings (with Date and Price)
				if (booking['Date'] && booking['Price']) {
					const price = parseFloat(String(booking['Price']).replace(/[$,]/g, ''));
					if (!isNaN(price)) {
						totalSpending[bookingKey] += price;
						bookingCounts[bookingKey]++;
					}
				}
			}
		});
		
		// Calculate averages
		Object.keys(totalSpending).forEach(key => {
			avgSpending[key] = bookingCounts[key] > 0 ? totalSpending[key] / bookingCounts[key] : 0;
		});
		
		// Get unique customers sorted by total spending
		const uniqueCustomers = customerList.map(customer => {
			const key = getCustomerKey(customer);
			return {
				name: customer['Customer'] || 'Unknown',
				email: customer['Email'] || '',
				phone: customer['Number'] || '',
				totalSpent: totalSpending[key] || 0,
				avgSpent: avgSpending[key] || 0,
				bookings: bookingCounts[key] || 0,
				customerData: customer
			};
		}).sort((a, b) => b.totalSpent - a.totalSpent);
		
		// Calculate category statistics
		const totalCategorySpending = uniqueCustomers.reduce((sum, c) => sum + c.totalSpent, 0);
		const totalCategoryBookings = uniqueCustomers.reduce((sum, c) => sum + c.bookings, 0);
		const avgCategorySpending = totalCategoryBookings > 0 ? totalCategorySpending / totalCategoryBookings : 0;
		
		// Gender-specific colors
		const genderColors = {
			'Male': 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
			'Female': 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
			'Business': 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)'
		};
		const genderColor = genderColors[label] || 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
		
		const customerRows = uniqueCustomers.map((customer, index) => {
			const rankBadge = index < 3 ? `<span style="background: ${index === 0 ? '#FFD700' : index === 1 ? '#C0C0C0' : '#CD7F32'}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.8rem; font-weight: bold; margin-left: 8px;">#${index + 1}</span>` : '';
			
			return `
				<div class="customer-result demo-customer-item" data-customer-index="${index}" style="padding: 15px; border-bottom: 1px solid #e0e0e0; cursor: pointer; transition: all 0.2s; border-left: 4px solid transparent; background: white;" 
					onmouseover="this.style.background='#f8f9fa'; this.style.borderLeftColor='#8b5cf6'; this.style.transform='translateX(5px)'" 
					onmouseout="this.style.background='white'; this.style.borderLeftColor='transparent'; this.style.transform='translateX(0)'">
					<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
						<div style="flex: 1;">
							<strong style="color: #2193b0; font-size: 1.1rem;">${customer.name}</strong>
							${rankBadge}
						</div>
						<div style="text-align: right; color: #27ae60; font-weight: bold; font-size: 1.1rem;">
							$${customer.totalSpent.toFixed(2)}
						</div>
					</div>
					<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; font-size: 0.9rem; color: #666;">
						<div>
							<div style="color: #999; font-size: 0.8rem;">Bookings</div>
							<div style="font-weight: 600;">${customer.bookings}</div>
						</div>
						<div>
							<div style="color: #999; font-size: 0.8rem;">Avg/Booking</div>
							<div style="font-weight: 600;">$${customer.avgSpent.toFixed(2)}</div>
						</div>
						<div>
							<div style="color: #999; font-size: 0.8rem;">Contact</div>
							<div style="font-weight: 600;">${customer.phone ? '📞' : customer.email ? '📧' : '—'}</div>
						</div>
					</div>
				</div>
			`;
		}).join('');
		
		const modal = document.createElement('div');
		modal.className = 'info-popup';
		modal.style.cssText = `
			position: fixed;
			top: 0;
			left: 0;
			width: 100%;
			height: 100%;
			background: rgba(0, 0, 0, 0.7);
			backdrop-filter: blur(10px);
			display: flex;
			align-items: center;
			justify-content: center;
			z-index: 10000;
		`;
		
		modal.innerHTML = `
			<div class="info-popup-content" style="max-width: 700px; width: 90%; max-height: 85vh; overflow: hidden; background: white; border-radius: 20px; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
				<div style="position: sticky; top: 0; background: ${genderColor}; padding: 25px; border-radius: 20px 20px 0 0; z-index: 1; color: white;">
					<span class="info-popup-close" style="position: absolute; top: 15px; right: 20px; font-size: 32px; cursor: pointer; color: white; text-shadow: 0 2px 4px rgba(0,0,0,0.2);">&times;</span>
					<div style="display: flex; align-items: center; gap: 15px; margin-bottom: 15px;">
						<span style="font-size: 3rem;">⚧</span>
						<div>
							<h3 style="margin: 0; font-size: 1.8rem; font-weight: 700;">
								${label}
							</h3>
							<p style="margin: 5px 0 0 0; opacity: 0.9; font-size: 1rem;">
								${uniqueCustomers.length} customer${uniqueCustomers.length !== 1 ? 's' : ''}
							</p>
						</div>
					</div>
					<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-top: 15px;">
						<div style="background: rgba(255,255,255,0.2); padding: 12px; border-radius: 10px; backdrop-filter: blur(10px);">
							<div style="font-size: 0.85rem; opacity: 0.9; margin-bottom: 5px;">Total Revenue</div>
							<div style="font-size: 1.3rem; font-weight: 700;">$${totalCategorySpending.toFixed(2)}</div>
						</div>
						<div style="background: rgba(255,255,255,0.2); padding: 12px; border-radius: 10px; backdrop-filter: blur(10px);">
							<div style="font-size: 0.85rem; opacity: 0.9; margin-bottom: 5px;">Total Bookings</div>
							<div style="font-size: 1.3rem; font-weight: 700;">${totalCategoryBookings}</div>
						</div>
						<div style="background: rgba(255,255,255,0.2); padding: 12px; border-radius: 10px; backdrop-filter: blur(10px);">
							<div style="font-size: 0.85rem; opacity: 0.9; margin-bottom: 5px;">Avg/Booking</div>
							<div style="font-size: 1.3rem; font-weight: 700;">$${avgCategorySpending.toFixed(2)}</div>
						</div>
					</div>
				</div>
				<div style="overflow-y: auto; max-height: calc(85vh - 200px); padding: 10px;">
					${customerRows}
				</div>
			</div>
		`;
		
		document.body.appendChild(modal);
		
		// Add click handlers to customer items
		modal.querySelectorAll('.demo-customer-item').forEach((elem, idx) => {
			elem.addEventListener('click', function(e) {
				e.stopPropagation();
				const index = parseInt(this.getAttribute('data-customer-index'));
				const customer = uniqueCustomers[index];
				if (customer && customer.customerData) {
					modal.remove();
					window.displayCustomerDetails(customer.customerData, allCustomers);
				}
			});
		});
		
		modal.querySelector('.info-popup-close').addEventListener('click', () => modal.remove());
		modal.addEventListener('click', (e) => {
			if (e.target === modal) modal.remove();
		});
		
		return;
	}
	
	// Standard popup for other categories
	const modal = document.createElement('div');
	modal.className = 'info-popup';
	modal.style.cssText = `
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: rgba(0, 0, 0, 0.7);
		backdrop-filter: blur(10px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 10000;
	`;
	
	const uniqueCustomerNames = Array.from(new Set(customerList.map(c => c['Customer'])));
	
	const customerRows = uniqueCustomerNames.map(name => {
		return `
			<div class="customer-result" style="padding: 12px; border-bottom: 1px solid #e0e0e0; cursor: pointer; transition: background 0.2s;" 
				onmouseover="this.style.background='#f5f5f5'" 
				onmouseout="this.style.background='white'"
				onclick="window.closePopupAndShowCustomer('${name.replace(/'/g, "\\'")}')">
				<strong style="color: #2193b0; font-size: 1.1rem;">${name}</strong>
			</div>
		`;
	}).join('');
	
	modal.innerHTML = `
		<div class="info-popup-content" style="max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto; background: white; border-radius: 15px; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
			<div style="position: sticky; top: 0; background: white; padding: 20px; border-bottom: 2px solid #2193b0; z-index: 1;">
				<span class="info-popup-close" style="position: absolute; top: 15px; right: 20px; font-size: 28px; cursor: pointer; color: #999;">&times;</span>
				<h3 style="margin: 0; color: #2193b0;">
					${categoryIcons[category]} ${categoryNames[category]}: ${label}
				</h3>
				<p style="margin: 10px 0 0 0; color: #666;">
					${uniqueCustomerNames.length} customer${uniqueCustomerNames.length !== 1 ? 's' : ''}
				</p>
			</div>
			<div style="padding: 10px;">
				${customerRows}
			</div>
		</div>
	`;
	
	document.body.appendChild(modal);
	
	// Close on X or outside click
	modal.querySelector('.info-popup-close').addEventListener('click', () => modal.remove());
	modal.addEventListener('click', (e) => {
		if (e.target === modal) modal.remove();
	});
}

// Helper function to close popup and show customer profile
window.closePopupAndShowCustomer = async function(customerName) {
	// Close the popup
	const popup = document.querySelector('.info-popup');
	if (popup) popup.remove();
	
	// Load customers and find the one with this name
	const customers = await loadCustomers();
	const customer = customers.find(c => c['Customer'] === customerName);
	
	if (customer) {
		displayCustomerDetails(customer, customers);
	}
}

// Initialize dashboard on page load

// Initialize dashboard on page load
window.addEventListener('DOMContentLoaded', async () => {
	await renderDashboard();
	renderDueCustomers6Months();
	renderDueCustomers12Months();
	renderTopSpenders();
	renderReturningCustomersPieChart();
	renderDemographicsCharts();
	
	// Start sections collapsed
	document.getElementById('due-customers-6months').style.display = 'none';
	document.getElementById('due-customers-12months').style.display = 'none';
	document.getElementById('top-spenders').style.display = 'none';
	document.getElementById('returning-customers-chart').style.display = 'none';
	document.getElementById('demographics-charts').style.display = 'none';
	document.getElementById('arrow-6months').textContent = '▶';
	document.getElementById('arrow-12months').textContent = '▶';
	document.getElementById('arrow-top-spenders').textContent = '▶';
	document.getElementById('arrow-returning-customers').textContent = '▶';
	document.getElementById('arrow-demographics').textContent = '▶';
});

// Toggle section collapse/expand
window.toggleSection = function(sectionId) {
	const section = document.getElementById(sectionId);
	let title = '';
	if (sectionId === 'due-customers-6months') {
		title = 'Customers Due for Service (6+ Months)';
	} else if (sectionId === 'due-customers-12months') {
		title = 'Customers Due for Service (12+ Months)';
	} else if (sectionId === 'top-spenders') {
		title = 'Top 10 Customers by Total Spending';
	} else if (sectionId === 'returning-customers-chart') {
		title = 'Returning Customers by Bookings';
	} else if (sectionId === 'demographics-charts') {
		title = 'Customer Demographics';
	}

	// Create modal
	const modal = document.createElement('div');
	modal.className = 'customer-profile-modal';
	modal.style.cssText = `
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: rgba(0, 0, 0, 0.7);
		display: flex;
		justify-content: center;
		align-items: center;
		z-index: 10000;
		backdrop-filter: blur(10px);
		padding: 20px;
		box-sizing: border-box;
	`;

	modal.innerHTML = `
		<div class="customer-card" onclick="event.stopPropagation()" style="max-width: 900px; width: 100%; max-height: 90vh; overflow-y: auto; margin: auto; pointer-events: auto; position: relative; z-index: 10001;">
			<span class="close-stat-btn" style="
				position: absolute;
				top: 18px;
				right: 18px;
				width: 44px;
				height: 44px;
				display: flex;
				align-items: center;
				justify-content: center;
				border-radius: 50%;
				background: linear-gradient(135deg, #f8fafc 0%, #e9ecef 100%);
				box-shadow: 0 2px 12px rgba(44,62,80,0.10);
				cursor: pointer;
				z-index: 10;
				border: 1px solid #e0e6ed;
				transition: box-shadow 0.2s, background 0.2s, transform 0.2s;
			" onmouseover="this.style.background='linear-gradient(135deg, #e74c3c 0%, #e67e22 100%)'; this.style.boxShadow='0 4px 16px rgba(231,76,60,0.18)'; this.style.transform='scale(1.08) rotate(90deg)';" 
			   onmouseout="this.style.background='linear-gradient(135deg, #f8fafc 0%, #e9ecef 100%)'; this.style.boxShadow='0 2px 12px rgba(44,62,80,0.10)'; this.style.transform='scale(1) rotate(0deg)';">
				<svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
				  <circle cx="11" cy="11" r="10" fill="white"/>
				  <path d="M7 7L15 15M15 7L7 15" stroke="#e74c3c" stroke-width="2.2" stroke-linecap="round"/>
				</svg>
			</span>
			<div style="margin-bottom: 20px; pointer-events: none;">
				<h3 style="margin: 0;">${title}</h3>
			</div>
			<div style="position: relative; z-index: 10002; padding-bottom: 20px;">
				${section.innerHTML}
			</div>
		</div>
	`;

	modal.addEventListener('click', function(e) {
		if (e.target === modal) {
			modal.remove();
		}
	});

	document.body.appendChild(modal);

	// Add click handler for close button
	const closeBtn = modal.querySelector('.close-stat-btn');
	if (closeBtn) {
		closeBtn.addEventListener('click', function(e) {
			e.stopPropagation();
			e.preventDefault();
			modal.remove();
		});
	}
};

// Show add customer form
function showAddCustomerForm() {
	const modal = document.createElement('div');
	modal.className = 'customer-profile-modal';
	modal.style.cssText = `
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: rgba(0, 0, 0, 0.7);
		backdrop-filter: blur(10px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 9999;
		overflow-y: auto;
		padding: 20px;
		box-sizing: border-box;
	`;
	
	modal.innerHTML = `
		<div class="add-customer-modal-card" onclick="event.stopPropagation()" style="max-width: 600px; width: 100%; margin: auto; position: relative; pointer-events: auto; background: rgba(255, 255, 255, 0.98); backdrop-filter: blur(20px); border-radius: 20px; padding: 30px; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
			<button class="close-modal-btn" style="position:absolute; top:15px; right:15px; background:transparent; color:#999; border:none; font-size:28px; cursor:pointer; line-height:1; padding:0; width:30px; height:30px; pointer-events: auto; z-index: 10;">&times;</button>
			<h2 style="margin-top: 0; background: var(--primary-gradient); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; pointer-events: none;">Add New Customer</h2>
			<form id="add-customer-form" style="display: flex; flex-direction: column; gap: 15px; pointer-events: auto; position: relative; z-index: 1;">
				<div>
					<label style="display: block; margin-bottom: 5px; color: #555; font-weight: 600; pointer-events: none;">Customer Name *</label>
					<input type="text" name="Customer" required style="width: 100%; padding: 10px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 14px; box-sizing: border-box; pointer-events: auto; background: white; position: relative; z-index: 2;">
				</div>
				<div>
					<label style="display: block; margin-bottom: 5px; color: #555; font-weight: 600; pointer-events: none;">Email *</label>
					<input type="email" name="Email" id="add-email" style="width: 100%; padding: 10px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 14px; box-sizing: border-box; pointer-events: auto; background: white; position: relative; z-index: 2;">
				</div>
				<div>
					<label style="display: block; margin-bottom: 5px; color: #555; font-weight: 600; pointer-events: none;">Phone Number *</label>
					<input type="tel" name="Number" id="add-phone" style="width: 100%; padding: 10px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 14px; box-sizing: border-box; pointer-events: auto; background: white; position: relative; z-index: 2;">
				</div>
				<div>
					<label style="display: block; margin-bottom: 5px; color: #555; font-weight: 600; pointer-events: none;">Address *</label>
					<input type="text" name="Address" required style="width: 100%; padding: 10px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 14px; box-sizing: border-box; pointer-events: auto; background: white; position: relative; z-index: 2;">
				</div>
				<div>
					<label style="display: block; margin-bottom: 5px; color: #555; font-weight: 600; pointer-events: none;">Service Date *</label>
					<input type="date" name="Date" required style="width: 100%; padding: 10px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 14px; box-sizing: border-box; pointer-events: auto; background: white; position: relative; z-index: 2;">
				</div>
				<div>
					<label style="display: block; margin-bottom: 5px; color: #555; font-weight: 600; pointer-events: none;">Service *</label>
					<input type="text" name="Service" required style="width: 100%; padding: 10px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 14px; box-sizing: border-box; pointer-events: auto; background: white; position: relative; z-index: 2;">
				</div>
				<div>
					<label style="display: block; margin-bottom: 5px; color: #555; font-weight: 600; pointer-events: none;">Price *</label>
					<input type="number" name="Price" step="0.01" required style="width: 100%; padding: 10px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 14px; box-sizing: border-box; pointer-events: auto; background: white; position: relative; z-index: 2;">
				</div>
				<div style="display: flex; gap: 10px; margin-top: 10px; position: relative; z-index: 2;">
					<button type="submit" style="flex: 1; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 16px; pointer-events: auto;">Add Customer</button>
					<button type="button" id="cancel-add-btn" style="background: #666; color: white; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-weight: bold; pointer-events: auto;">Cancel</button>
				</div>
			</form>
		</div>
	`;
	
	document.body.appendChild(modal);
	
	// Close button handler
	modal.querySelector('.close-modal-btn').addEventListener('click', () => {
		modal.remove();
	});
	
	// Cancel button handler
	modal.querySelector('#cancel-add-btn').addEventListener('click', () => {
		modal.remove();
	});
	
	// Click outside to close
	modal.addEventListener('click', (e) => {
		if (e.target === modal) {
			modal.remove();
		}
	});
	
	// Form submit handler
	modal.querySelector('#add-customer-form').addEventListener('submit', async (e) => {
		e.preventDefault();
		const formData = new FormData(e.target);
		const newCustomer = Object.fromEntries(formData.entries());

		// Validation: require all fields except only one of email or phone
		const requiredFields = ['Customer', 'Address', 'Date', 'Service', 'Price'];
		let missing = requiredFields.filter(f => !newCustomer[f] || newCustomer[f].trim() === '');
		const email = newCustomer['Email'] && newCustomer['Email'].trim();
		const phone = newCustomer['Number'] && newCustomer['Number'].trim();
		if (!email && !phone) {
			missing.push('Email or Phone');
		}
		if (missing.length > 0) {
			alert('Please fill out all required fields. You must provide an Email or Phone. Missing: ' + missing.join(', '));
			return;
		}

		// Add to CSV via server
		try {
			const response = await fetch('/add-customer', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(newCustomer)
			});

			if (response.ok) {
				alert('Customer added successfully!');
				modal.remove();
				// Refresh the dashboard
				renderDashboard();
			} else {
				alert('Failed to add customer');
			}
		} catch (err) {
			console.error('Error adding customer:', err);
			alert('Error adding customer: ' + err.message);
		}
	});
}
