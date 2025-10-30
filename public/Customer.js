// Customer Database Application
class CustomerDatabase {
    constructor() {
        this.customers = this.loadCustomers();
        this.savedSearches = this.loadSavedSearches();
        this.currentEditingId = null;
        this.currentSearchResults = null;
        this.previewData = null;
        this.sheetConfigs = this.initializeSheetConfigs();
        this.initializeEventListeners();
        this.renderCustomers();
        this.updateCustomerCount();
        this.loadSavedSearchOptions();
        this.handleSheetTypeChange('bookings'); // Initialize with bookings sheet
    }

    // Load saved searches from localStorage
    loadSavedSearches() {
        const stored = localStorage.getItem('savedSearches');
        return stored ? JSON.parse(stored) : {};
    }

    // Save searches to localStorage
    saveSavedSearches() {
        localStorage.setItem('savedSearches', JSON.stringify(this.savedSearches));
    }

    // Initialize sheet configurations
    initializeSheetConfigs() {
        return {
            bookings: {
                name: "New Bookings Sheet",
                url: "https://docs.google.com/spreadsheets/d/152pBQmy7OKze84ShxJLj4MUPLFquHXjIvaTk-cCJYco/edit?gid=987855776#gid=987855776",
                description: "Import new customer bookings from your booking form",
                startRow: 2,
                mapping: {
                    date: "A",
                    customer: "B", 
                    package: "C",
                    size: "D",
                    addOns: "E",
                    price: "F",
                    time: "G",
                    endTime: "H",
                    heardFrom: "I",
                    email: "J",
                    number: "K",
                    address: "L"
                }
            },
            customers: {
                name: "Existing Customer Database",
                url: "https://docs.google.com/spreadsheets/d/1D7ca69NjYhzUH7tUjLl0IPq6VyYKboSeMPiUhQmODoQ/edit?gid=0#gid=0",
                description: "Import from your existing customer database sheet",
                startRow: 2,
                mapping: {
                    date: "A",
                    customer: "B",
                    email: "C", 
                    number: "D",
                    address: "E",
                    package: "F",
                    size: "G",
                    addOns: "H",
                    price: "I",
                    time: "J",
                    endTime: "K",
                    heardFrom: "L"
                }
            },
            custom: {
                name: "Custom Sheet",
                url: "",
                description: "Configure custom column mapping for any sheet",
                startRow: 2,
                mapping: {
                    date: "A",
                    customer: "B",
                    email: "C",
                    number: "D",
                    package: "E",
                    size: "F",
                    addOns: "G",
                    price: "H",
                    time: "I",
                    endTime: "J",
                    heardFrom: "K",
                    address: "L"
                }
            }
        };
    }

    // Handle sheet type change
    handleSheetTypeChange(sheetType) {
        const config = this.sheetConfigs[sheetType];
        if (!config) return;

        // Update URL
        document.getElementById('sheetsUrl').value = config.url;
        
        // Update start row
        document.getElementById('startRow').value = config.startRow;
        
        // Update description
        document.getElementById('mappingDescription').textContent = config.description;
        
        // Update column mappings
        this.updateColumnMapping(config.mapping);
        
        // Enable/disable URL field for custom sheets
        document.getElementById('sheetsUrl').disabled = sheetType !== 'custom';
    }

    // Update column mapping interface
    updateColumnMapping(mapping) {
        const mappingGrid = document.getElementById('mappingGrid');
        
        const fields = [
            { key: 'date', label: 'Date' },
            { key: 'customer', label: 'Customer Name' },
            { key: 'email', label: 'Email' },
            { key: 'number', label: 'Phone Number' },
            { key: 'package', label: 'Package' },
            { key: 'size', label: 'Size' },
            { key: 'addOns', label: 'Add-ons' },
            { key: 'price', label: 'Price' },
            { key: 'time', label: 'Time' },
            { key: 'endTime', label: 'End Time' },
            { key: 'heardFrom', label: 'Heard From' },
            { key: 'address', label: 'Address' }
        ];

        mappingGrid.innerHTML = fields.map(field => `
            <div class="mapping-row">
                <label>${field.label}:</label>
                <input type="text" id="map${field.key.charAt(0).toUpperCase() + field.key.slice(1)}" 
                       placeholder="Column letter/name" value="${mapping[field.key] || ''}">
            </div>
        `).join('');
    }

    // Setup auto-sync functionality
    setupAutoSync() {
        const modal = confirm(`Auto-Sync Setup
        
This will set up automatic importing from your sheets:

🆕 New Bookings: Check every 15 minutes for new bookings
👥 Customer Updates: Sync existing customers daily
🔄 Background Process: Runs automatically when app is open

Note: Your browser needs to stay open for auto-sync to work.

Would you like to enable auto-sync?`);

        if (modal) {
            this.enableAutoSync();
        }
    }

    // Enable auto-sync
    enableAutoSync() {
        // Set up periodic checking for new bookings (every 15 minutes)
        this.autoSyncInterval = setInterval(() => {
            this.autoImportNewBookings();
        }, 15 * 60 * 1000); // 15 minutes

        // Set up daily customer database sync (every 24 hours)
        this.dailySyncInterval = setInterval(() => {
            this.autoSyncCustomerDatabase();
        }, 24 * 60 * 60 * 1000); // 24 hours

        // Store auto-sync status
        localStorage.setItem('autoSyncEnabled', 'true');
        localStorage.setItem('lastAutoSync', new Date().toISOString());

        this.showNotification('🔄 Auto-sync enabled! Checking for new bookings every 15 minutes.');
        
        // Run initial sync
        this.autoImportNewBookings();
    }

    // Auto-import new bookings
    async autoImportNewBookings() {
        try {
            // Temporarily switch to bookings configuration
            const originalSheetType = document.querySelector('input[name="sheetType"]:checked').value;
            
            // Set to bookings mode
            document.querySelector('input[name="sheetType"][value="bookings"]').checked = true;
            this.handleSheetTypeChange('bookings');
            
            // Get last sync date to only import new records
            const lastSync = localStorage.getItem('lastAutoSync');
            const lastSyncDate = lastSync ? new Date(lastSync) : new Date(Date.now() - 24 * 60 * 60 * 1000); // Default to 24 hours ago
            
            // Run import silently
            await this.previewSheetsImport(true); // Silent mode
            
            if (this.previewData && this.previewData.length > 0) {
                // Filter for records newer than last sync
                const newRecords = this.previewData.filter(record => {
                    const recordDate = new Date(record.date);
                    return recordDate > lastSyncDate;
                });
                
                if (newRecords.length > 0) {
                    this.previewData = newRecords;
                    await this.executeSheetsImport(true); // Silent mode
                    this.showNotification(`🆕 Auto-sync: ${newRecords.length} new booking${newRecords.length !== 1 ? 's' : ''} imported`);
                }
            }
            
            // Update last sync time
            localStorage.setItem('lastAutoSync', new Date().toISOString());
            
            // Restore original sheet type
            document.querySelector(`input[name="sheetType"][value="${originalSheetType}"]`).checked = true;
            this.handleSheetTypeChange(originalSheetType);
            
        } catch (error) {
            console.error('Auto-sync error:', error);
        }
    }

    // Auto-sync customer database
    async autoSyncCustomerDatabase() {
        try {
            // Similar to autoImportNewBookings but for customer database
            this.showNotification('🔄 Running daily customer database sync...');
            
            // Implementation would check for updates in the customer database sheet
            // and update existing records if they've changed
            
        } catch (error) {
            console.error('Customer database sync error:', error);
        }
    }

    // Load customers from localStorage
    loadCustomers() {
        const stored = localStorage.getItem('customerDatabase');
        return stored ? JSON.parse(stored) : [];
    }

    // Save customers to localStorage
    saveCustomers() {
        localStorage.setItem('customerDatabase', JSON.stringify(this.customers));
    }

    // Initialize all event listeners
    initializeEventListeners() {
        console.log('Initializing event listeners...');
        
        try {
            // Form toggle
            const toggleFormBtn = document.getElementById('toggleForm');
            if (toggleFormBtn) {
                toggleFormBtn.addEventListener('click', () => {
                    console.log('Toggle form clicked');
                    this.toggleForm();
                });
            } else {
                console.error('toggleForm button not found');
            }

            // Form submission
            const customerForm = document.getElementById('customerForm');
            if (customerForm) {
                customerForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    console.log('Form submitted');
                    this.saveCustomer();
                });
            } else {
                console.error('customerForm not found');
            }

            // Cancel form
            const cancelFormBtn = document.getElementById('cancelForm');
            if (cancelFormBtn) {
                cancelFormBtn.addEventListener('click', () => {
                    console.log('Cancel form clicked');
                    this.cancelForm();
                });
            } else {
                console.error('cancelForm button not found');
            }

            // Search functionality
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    this.searchCustomers(e.target.value);
                });
            } else {
                console.error('searchInput not found');
            }

            // Advanced search toggle
            const toggleAdvancedSearchBtn = document.getElementById('toggleAdvancedSearch');
            if (toggleAdvancedSearchBtn) {
                toggleAdvancedSearchBtn.addEventListener('click', () => {
                    console.log('Advanced search toggle clicked');
                    this.toggleAdvancedSearch();
                });
            } else {
                console.error('toggleAdvancedSearch button not found');
            }

            // Advanced search apply
            const applyAdvancedSearchBtn = document.getElementById('applyAdvancedSearch');
            if (applyAdvancedSearchBtn) {
                applyAdvancedSearchBtn.addEventListener('click', () => {
                    console.log('Apply advanced search clicked');
                    this.applyAdvancedSearch();
                });
            } else {
                console.error('applyAdvancedSearch button not found');
            }

            // Clear advanced search
            const clearAdvancedSearchBtn = document.getElementById('clearAdvancedSearch');
            if (clearAdvancedSearchBtn) {
                clearAdvancedSearchBtn.addEventListener('click', () => {
                    console.log('Clear advanced search clicked');
                    this.clearAdvancedSearch();
                });
            } else {
                console.error('clearAdvancedSearch button not found');
            }

            // Save search
            const saveSearchBtn = document.getElementById('saveSearch');
            if (saveSearchBtn) {
                saveSearchBtn.addEventListener('click', () => {
                    console.log('Save search clicked');
                    this.saveCurrentSearch();
                });
            } else {
                console.error('saveSearch button not found');
            }

            // Load saved search
            const savedSearchesSelect = document.getElementById('savedSearches');
            if (savedSearchesSelect) {
                savedSearchesSelect.addEventListener('change', (e) => {
                    this.loadSavedSearch(e.target.value);
                });
            } else {
                console.error('savedSearches select not found');
            }

            // Clear search
            const clearSearchBtn = document.getElementById('clearSearch');
            if (clearSearchBtn) {
                clearSearchBtn.addEventListener('click', () => {
                    console.log('Clear search clicked');
                    document.getElementById('searchInput').value = '';
                    document.getElementById('packageFilter').value = '';
                    document.getElementById('sizeFilter').value = '';
                    this.clearAdvancedSearch();
                    this.renderCustomers();
                    this.updateSearchResults();
                });
            } else {
                console.error('clearSearch button not found');
            }

            // Package filter
            const packageFilter = document.getElementById('packageFilter');
            if (packageFilter) {
                packageFilter.addEventListener('change', (e) => {
                    this.filterByPackage(e.target.value);
                });
            } else {
                console.error('packageFilter not found');
            }

            // Size filter
            const sizeFilter = document.getElementById('sizeFilter');
            if (sizeFilter) {
                sizeFilter.addEventListener('change', (e) => {
                    this.filterBySize(e.target.value);
                });
            } else {
                console.error('sizeFilter not found');
            }

            // Export data
            const exportDataBtn = document.getElementById('exportData');
            if (exportDataBtn) {
                exportDataBtn.addEventListener('click', () => {
                    console.log('Export data clicked');
                    this.exportData();
                });
            } else {
                console.error('exportData button not found');
            }

            // Google Sheets Import
            const importFromSheetsBtn = document.getElementById('importFromSheets');
            if (importFromSheetsBtn) {
                importFromSheetsBtn.addEventListener('click', () => {
                    console.log('Import from sheets clicked');
                    this.toggleSheetsImport();
                });
            } else {
                console.error('importFromSheets button not found');
            }

            const previewImportBtn = document.getElementById('previewImport');
            if (previewImportBtn) {
                previewImportBtn.addEventListener('click', () => {
                    console.log('Preview import clicked');
                    this.previewSheetsImport();
                });
            } else {
                console.error('previewImport button not found');
            }

            const executeImportBtn = document.getElementById('executeImport');
            if (executeImportBtn) {
                executeImportBtn.addEventListener('click', () => {
                    console.log('Execute import clicked');
                    this.executeSheetsImport();
                });
            } else {
                console.error('executeImport button not found');
            }

            const cancelImportBtn = document.getElementById('cancelImport');
            if (cancelImportBtn) {
                cancelImportBtn.addEventListener('click', () => {
                    console.log('Cancel import clicked');
                    this.cancelSheetsImport();
                });
            } else {
                console.error('cancelImport button not found');
            }

            // Auto-sync setup
            const autoSyncBtn = document.getElementById('autoSync');
            if (autoSyncBtn) {
                autoSyncBtn.addEventListener('click', () => {
                    console.log('Auto-sync clicked');
                    this.setupAutoSync();
                });
            } else {
                console.error('autoSync button not found');
            }

            // Test import functionality
            const testImportBtn = document.getElementById('testImport');
            if (testImportBtn) {
                testImportBtn.addEventListener('click', () => {
                    console.log('Test import clicked');
                    this.testImport();
                });
            } else {
                console.error('testImport button not found');
            }

            // Sheet type radio buttons - with delay to ensure DOM is ready
            setTimeout(() => {
                const radioButtons = document.querySelectorAll('input[name="sheetType"]');
                radioButtons.forEach(radio => {
                    radio.addEventListener('change', (e) => {
                        this.handleSheetTypeChange(e.target.value);
                    });
                });
            }, 100);

            console.log('All event listeners initialized successfully');
        } catch (error) {
            console.error('Error initializing event listeners:', error);
        }

        // Additional event listeners for modal and keyboard interactions
        this.initializeModalEventListeners();
    }

    // Initialize modal-specific event listeners
    initializeModalEventListeners() {
        // Modal close
        const closeModalBtn = document.getElementById('closeModal');
        if (closeModalBtn) {
            closeModalBtn.addEventListener('click', () => {
                this.closeModal();
            });
        }

        // Modal backdrop close
        const customerModal = document.getElementById('customerModal');
        if (customerModal) {
            customerModal.addEventListener('click', (e) => {
                if (e.target.id === 'customerModal') {
                    this.closeModal();
                }
            });
        }

        // Edit customer
        const editCustomerBtn = document.getElementById('editCustomer');
        if (editCustomerBtn) {
            editCustomerBtn.addEventListener('click', () => {
                this.editCustomer();
            });
        }

        // Delete customer
        const deleteCustomerBtn = document.getElementById('deleteCustomer');
        if (deleteCustomerBtn) {
            deleteCustomerBtn.addEventListener('click', () => {
                this.deleteCustomer();
            });
        }

        // Escape key to close modal
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeModal();
            }
        });
    }

    // Toggle form visibility
    toggleForm() {
        const form = document.getElementById('customerForm');
        const button = document.getElementById('toggleForm');
        
        if (form.classList.contains('hidden')) {
            form.classList.remove('hidden');
            button.textContent = 'Cancel';
            this.resetForm();
            // Set today's date as default
            document.getElementById('date').value = new Date().toISOString().split('T')[0];
        } else {
            form.classList.add('hidden');
            button.textContent = 'Add New Customer Record';
            this.currentEditingId = null;
        }
    }

    // Cancel form
    cancelForm() {
        const form = document.getElementById('customerForm');
        const button = document.getElementById('toggleForm');
        
        form.classList.add('hidden');
        button.textContent = 'Add New Customer Record';
        this.currentEditingId = null;
        this.resetForm();
    }

    // Reset form fields
    resetForm() {
        document.getElementById('customerForm').reset();
        document.getElementById('formTitle').textContent = 'Add New Customer Record';
        this.currentEditingId = null;
        // Set today's date as default
        document.getElementById('date').value = new Date().toISOString().split('T')[0];
    }

    // Generate unique ID
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    // Save customer (add or update)
    saveCustomer() {
        const formData = {
            id: this.currentEditingId || this.generateId(),
            date: document.getElementById('date').value,
            customer: document.getElementById('customer').value.trim(),
            email: document.getElementById('email').value.trim(),
            number: document.getElementById('number').value.trim(),
            address: document.getElementById('address').value.trim(),
            package: document.getElementById('package').value,
            size: document.getElementById('size').value,
            addOns: document.getElementById('addOns').value.trim(),
            price: document.getElementById('price').value,
            time: document.getElementById('time').value,
            endTime: document.getElementById('endTime').value,
            heardFrom: document.getElementById('heardFrom').value,
            notes: document.getElementById('notes').value.trim(),
            dateAdded: this.currentEditingId ? 
                this.customers.find(c => c.id === this.currentEditingId)?.dateAdded : 
                new Date().toISOString().split('T')[0],
            lastModified: new Date().toISOString().split('T')[0]
        };

        // Validation
        if (!formData.date || !formData.customer || !formData.email) {
            alert('Please fill in all required fields (Date, Customer Name, Email)');
            return;
        }

        // Check for duplicate email (excluding current customer if editing)
        const existingCustomer = this.customers.find(c => 
            c.email.toLowerCase() === formData.email.toLowerCase() && c.id !== formData.id
        );
        
        if (existingCustomer) {
            alert('A customer with this email already exists!');
            return;
        }

        if (this.currentEditingId) {
            // Update existing customer
            const index = this.customers.findIndex(c => c.id === this.currentEditingId);
            this.customers[index] = formData;
        } else {
            // Add new customer
            this.customers.push(formData);
        }

        this.saveCustomers();
        this.renderCustomers();
        this.updateCustomerCount();
        this.cancelForm();
        
        const action = this.currentEditingId ? 'updated' : 'added';
        this.showNotification(`Customer ${action} successfully!`);
    }

    // Render customers list
    renderCustomers(customersToRender = null) {
        const customerList = document.getElementById('customerList');
        const noCustomers = document.getElementById('noCustomers');
        const customers = customersToRender || this.customers;

        if (customers.length === 0) {
            customerList.innerHTML = '';
            noCustomers.classList.remove('hidden');
            return;
        }

        noCustomers.classList.add('hidden');
        
        customerList.innerHTML = customers.map(customer => {
            const customerName = customer.customer;
            const priceDisplay = customer.price ? `$${parseFloat(customer.price).toFixed(2)}` : 'No price set';
            const timeDisplay = customer.time && customer.endTime ? 
                `${customer.time} - ${customer.endTime}` : 
                customer.time ? `Start: ${customer.time}` : 'No time set';
            const packageInfo = customer.package ? `📦 ${customer.package}` : '';
            const sizeInfo = customer.size ? `📏 ${customer.size}` : '';

            return `
                <div class="customer-card" data-id="${customer.id}">
                    <div class="customer-date">${new Date(customer.date).toLocaleDateString()}</div>
                    <div class="customer-name">${customerName}</div>
                    <div class="customer-info">📧 ${customer.email}</div>
                    ${customer.number ? `<div class="customer-info">📞 ${customer.number}</div>` : ''}
                    ${packageInfo ? `<div class="customer-info customer-package">${packageInfo}</div>` : ''}
                    ${sizeInfo ? `<div class="customer-info">${sizeInfo}</div>` : ''}
                    <div class="customer-info customer-price">💰 ${priceDisplay}</div>
                    <div class="customer-time">${timeDisplay}</div>
                    ${customer.heardFrom ? `<div class="customer-heard-from">Heard from: ${customer.heardFrom}</div>` : ''}
                </div>
            `;
        }).join('');

        // Add click listeners to customer cards
        document.querySelectorAll('.customer-card').forEach(card => {
            card.addEventListener('click', () => {
                const customerId = card.dataset.id;
                this.showCustomerDetails(customerId);
            });
        });
    }

    // Show customer details in modal
    showCustomerDetails(customerId) {
        const customer = this.customers.find(c => c.id === customerId);
        if (!customer) return;

        const modal = document.getElementById('customerModal');
        const modalName = document.getElementById('modalCustomerName');
        const modalBody = document.querySelector('.modal-body');

        modalName.textContent = customer.customer;
        
        const details = [
            { label: 'Date', value: new Date(customer.date).toLocaleDateString() },
            { label: 'Customer Name', value: customer.customer },
            { label: 'Email', value: customer.email },
            { label: 'Phone Number', value: customer.number || 'Not provided' },
            { label: 'Address', value: customer.address || 'Not provided' },
            { label: 'Package', value: customer.package || 'Not selected' },
            { label: 'Size', value: customer.size || 'Not specified' },
            { label: 'Add-ons', value: customer.addOns || 'None' },
            { label: 'Price', value: customer.price ? `$${parseFloat(customer.price).toFixed(2)}` : 'Not set' },
            { label: 'Start Time', value: customer.time || 'Not set' },
            { label: 'End Time', value: customer.endTime || 'Not set' },
            { label: 'Heard From', value: customer.heardFrom || 'Not specified' },
            { label: 'Notes', value: customer.notes || 'No notes' },
            { label: 'Date Added', value: new Date(customer.dateAdded).toLocaleDateString() },
            { label: 'Last Modified', value: new Date(customer.lastModified).toLocaleDateString() }
        ];

        modalBody.innerHTML = `
            <div id="customerDetails">
                ${details.map(detail => `
                    <div class="customer-detail">
                        <div class="detail-label">${detail.label}:</div>
                        <div class="detail-value">${detail.value}</div>
                    </div>
                `).join('')}
            </div>
        `;

        // Store current customer ID for edit/delete actions
        modal.dataset.customerId = customerId;
        modal.classList.remove('hidden');
    }

    // Format customer address
    formatAddress(customer) {
        return customer.address || 'Not provided';
    }

    // Close modal
    closeModal() {
        document.getElementById('customerModal').classList.add('hidden');
    }

    // Edit customer
    editCustomer() {
        const modal = document.getElementById('customerModal');
        const customerId = modal.dataset.customerId;
        const customer = this.customers.find(c => c.id === customerId);
        
        if (!customer) return;

        // Populate form with customer data
        document.getElementById('date').value = customer.date;
        document.getElementById('customer').value = customer.customer;
        document.getElementById('email').value = customer.email;
        document.getElementById('number').value = customer.number || '';
        document.getElementById('address').value = customer.address || '';
        document.getElementById('package').value = customer.package || '';
        document.getElementById('size').value = customer.size || '';
        document.getElementById('addOns').value = customer.addOns || '';
        document.getElementById('price').value = customer.price || '';
        document.getElementById('time').value = customer.time || '';
        document.getElementById('endTime').value = customer.endTime || '';
        document.getElementById('heardFrom').value = customer.heardFrom || '';
        document.getElementById('notes').value = customer.notes || '';

        // Set form to edit mode
        this.currentEditingId = customerId;
        document.getElementById('formTitle').textContent = 'Edit Customer Record';
        document.getElementById('customerForm').classList.remove('hidden');
        document.getElementById('toggleForm').textContent = 'Cancel';

        this.closeModal();
    }

    // Delete customer
    deleteCustomer() {
        const modal = document.getElementById('customerModal');
        const customerId = modal.dataset.customerId;
        const customer = this.customers.find(c => c.id === customerId);
        
        if (!customer) return;

        const confirmDelete = confirm(
            `Are you sure you want to delete the record for ${customer.customer}? This action cannot be undone.`
        );

        if (confirmDelete) {
            this.customers = this.customers.filter(c => c.id !== customerId);
            this.saveCustomers();
            this.renderCustomers();
            this.updateCustomerCount();
            this.closeModal();
            this.showNotification('Customer deleted successfully!');
        }
    }

    // Search customers
    searchCustomers(searchTerm) {
        if (!searchTerm.trim()) {
            this.currentSearchResults = null;
            this.renderCustomers();
            this.updateSearchResults();
            return;
        }

        const term = searchTerm.toLowerCase();
        const filtered = this.customers.filter(customer => 
            customer.customer.toLowerCase().includes(term) ||
            customer.email.toLowerCase().includes(term) ||
            (customer.number && customer.number.includes(term)) ||
            (customer.address && customer.address.toLowerCase().includes(term)) ||
            (customer.package && customer.package.toLowerCase().includes(term)) ||
            (customer.size && customer.size.toLowerCase().includes(term)) ||
            (customer.addOns && customer.addOns.toLowerCase().includes(term)) ||
            (customer.heardFrom && customer.heardFrom.toLowerCase().includes(term)) ||
            (customer.notes && customer.notes.toLowerCase().includes(term)) ||
            (customer.price && customer.price.toString().includes(term))
        );

        this.currentSearchResults = filtered;
        this.renderCustomers(filtered);
        this.updateSearchResults(filtered.length);
    }

    // Filter by package
    filterByPackage(package) {
        if (!package) {
            this.currentSearchResults = null;
            this.renderCustomers();
            this.updateSearchResults();
            return;
        }

        const filtered = this.customers.filter(customer => customer.package === package);
        this.currentSearchResults = filtered;
        this.renderCustomers(filtered);
        this.updateSearchResults(filtered.length);
    }

    // Filter by size
    filterBySize(size) {
        if (!size) {
            this.currentSearchResults = null;
            this.renderCustomers();
            this.updateSearchResults();
            return;
        }

        const filtered = this.customers.filter(customer => customer.size === size);
        this.currentSearchResults = filtered;
        this.renderCustomers(filtered);
        this.updateSearchResults(filtered.length);
    }

    // Toggle advanced search panel
    toggleAdvancedSearch() {
        const panel = document.getElementById('advancedSearchPanel');
        const button = document.getElementById('toggleAdvancedSearch');
        
        if (panel.classList.contains('hidden')) {
            panel.classList.remove('hidden');
            button.textContent = 'Hide Advanced Search';
            button.style.background = '#dc3545';
        } else {
            panel.classList.add('hidden');
            button.textContent = 'Advanced Search';
            button.style.background = '#17a2b8';
        }
    }

    // Apply advanced search filters
    applyAdvancedSearch() {
        const filters = {
            customer: document.getElementById('searchCustomer').value.toLowerCase(),
            email: document.getElementById('searchEmail').value.toLowerCase(),
            phone: document.getElementById('searchPhone').value,
            package: document.getElementById('searchPackage').value,
            size: document.getElementById('searchSize').value,
            heardFrom: document.getElementById('searchHeardFrom').value,
            dateFrom: document.getElementById('searchDateFrom').value,
            dateTo: document.getElementById('searchDateTo').value,
            priceMin: parseFloat(document.getElementById('searchPriceMin').value) || 0,
            priceMax: parseFloat(document.getElementById('searchPriceMax').value) || Infinity,
            timeFrom: document.getElementById('searchTimeFrom').value,
            timeTo: document.getElementById('searchTimeTo').value,
            address: document.getElementById('searchAddress').value.toLowerCase(),
            notes: document.getElementById('searchNotes').value.toLowerCase()
        };

        const filtered = this.customers.filter(customer => {
            // Customer name filter
            if (filters.customer && !customer.customer.toLowerCase().includes(filters.customer)) {
                return false;
            }

            // Email filter
            if (filters.email && !customer.email.toLowerCase().includes(filters.email)) {
                return false;
            }

            // Phone filter
            if (filters.phone && (!customer.number || !customer.number.includes(filters.phone))) {
                return false;
            }

            // Package filter
            if (filters.package && customer.package !== filters.package) {
                return false;
            }

            // Size filter
            if (filters.size && customer.size !== filters.size) {
                return false;
            }

            // Heard from filter
            if (filters.heardFrom && customer.heardFrom !== filters.heardFrom) {
                return false;
            }

            // Date range filter
            if (filters.dateFrom && customer.date < filters.dateFrom) {
                return false;
            }
            if (filters.dateTo && customer.date > filters.dateTo) {
                return false;
            }

            // Price range filter
            const customerPrice = parseFloat(customer.price) || 0;
            if (customerPrice < filters.priceMin || customerPrice > filters.priceMax) {
                return false;
            }

            // Time range filter
            if (filters.timeFrom && customer.time && customer.time < filters.timeFrom) {
                return false;
            }
            if (filters.timeTo && customer.time && customer.time > filters.timeTo) {
                return false;
            }

            // Address filter
            if (filters.address && (!customer.address || !customer.address.toLowerCase().includes(filters.address))) {
                return false;
            }

            // Notes filter
            if (filters.notes && (!customer.notes || !customer.notes.toLowerCase().includes(filters.notes))) {
                return false;
            }

            return true;
        });

        this.currentSearchResults = filtered;
        this.renderCustomers(filtered);
        this.updateSearchResults(filtered.length);
        this.showNotification(`Found ${filtered.length} customer${filtered.length !== 1 ? 's' : ''} matching your criteria`);
    }

    // Clear advanced search
    clearAdvancedSearch() {
        // Clear all advanced search inputs
        document.getElementById('searchCustomer').value = '';
        document.getElementById('searchEmail').value = '';
        document.getElementById('searchPhone').value = '';
        document.getElementById('searchPackage').value = '';
        document.getElementById('searchSize').value = '';
        document.getElementById('searchHeardFrom').value = '';
        document.getElementById('searchDateFrom').value = '';
        document.getElementById('searchDateTo').value = '';
        document.getElementById('searchPriceMin').value = '';
        document.getElementById('searchPriceMax').value = '';
        document.getElementById('searchTimeFrom').value = '';
        document.getElementById('searchTimeTo').value = '';
        document.getElementById('searchAddress').value = '';
        document.getElementById('searchNotes').value = '';

        this.currentSearchResults = null;
        this.renderCustomers();
        this.updateSearchResults();
    }

    // Save current search
    saveCurrentSearch() {
        const searchName = prompt('Enter a name for this search:');
        if (!searchName) return;

        const searchCriteria = {
            customer: document.getElementById('searchCustomer').value,
            email: document.getElementById('searchEmail').value,
            phone: document.getElementById('searchPhone').value,
            package: document.getElementById('searchPackage').value,
            size: document.getElementById('searchSize').value,
            heardFrom: document.getElementById('searchHeardFrom').value,
            dateFrom: document.getElementById('searchDateFrom').value,
            dateTo: document.getElementById('searchDateTo').value,
            priceMin: document.getElementById('searchPriceMin').value,
            priceMax: document.getElementById('searchPriceMax').value,
            timeFrom: document.getElementById('searchTimeFrom').value,
            timeTo: document.getElementById('searchTimeTo').value,
            address: document.getElementById('searchAddress').value,
            notes: document.getElementById('searchNotes').value,
            quickSearch: document.getElementById('searchInput').value,
            packageFilter: document.getElementById('packageFilter').value,
            sizeFilter: document.getElementById('sizeFilter').value
        };

        this.savedSearches[searchName] = {
            criteria: searchCriteria,
            savedDate: new Date().toISOString()
        };

        this.saveSavedSearches();
        this.loadSavedSearchOptions();
        this.showNotification(`Search "${searchName}" saved successfully!`);
    }

    // Load saved search
    loadSavedSearch(searchName) {
        if (!searchName || !this.savedSearches[searchName]) return;

        const search = this.savedSearches[searchName];
        const criteria = search.criteria;

        // Populate all search fields
        document.getElementById('searchCustomer').value = criteria.customer || '';
        document.getElementById('searchEmail').value = criteria.email || '';
        document.getElementById('searchPhone').value = criteria.phone || '';
        document.getElementById('searchPackage').value = criteria.package || '';
        document.getElementById('searchSize').value = criteria.size || '';
        document.getElementById('searchHeardFrom').value = criteria.heardFrom || '';
        document.getElementById('searchDateFrom').value = criteria.dateFrom || '';
        document.getElementById('searchDateTo').value = criteria.dateTo || '';
        document.getElementById('searchPriceMin').value = criteria.priceMin || '';
        document.getElementById('searchPriceMax').value = criteria.priceMax || '';
        document.getElementById('searchTimeFrom').value = criteria.timeFrom || '';
        document.getElementById('searchTimeTo').value = criteria.timeTo || '';
        document.getElementById('searchAddress').value = criteria.address || '';
        document.getElementById('searchNotes').value = criteria.notes || '';
        document.getElementById('searchInput').value = criteria.quickSearch || '';
        document.getElementById('packageFilter').value = criteria.packageFilter || '';
        document.getElementById('sizeFilter').value = criteria.sizeFilter || '';

        // Show advanced search panel if it has criteria
        const hasAdvancedCriteria = Object.keys(criteria).some(key => 
            key !== 'quickSearch' && key !== 'packageFilter' && key !== 'sizeFilter' && criteria[key]
        );
        
        if (hasAdvancedCriteria) {
            const panel = document.getElementById('advancedSearchPanel');
            if (panel.classList.contains('hidden')) {
                this.toggleAdvancedSearch();
            }
        }

        // Apply the search
        this.applyAdvancedSearch();
        this.showNotification(`Loaded search "${searchName}"`);
    }

    // Load saved search options
    loadSavedSearchOptions() {
        const select = document.getElementById('savedSearches');
        select.innerHTML = '<option value="">Load Saved Search...</option>';
        
        Object.keys(this.savedSearches).forEach(searchName => {
            const option = document.createElement('option');
            option.value = searchName;
            option.textContent = `${searchName} (${new Date(this.savedSearches[searchName].savedDate).toLocaleDateString()})`;
            select.appendChild(option);
        });
    }

    // Update search results info
    updateSearchResults(count = null) {
        const resultsElement = document.getElementById('searchResults');
        if (count !== null) {
            resultsElement.textContent = `Showing ${count} of ${this.customers.length} records`;
            resultsElement.style.display = 'inline-block';
        } else {
            resultsElement.style.display = 'none';
        }
    }

    // Update customer count
    updateCustomerCount() {
        const count = this.customers.length;
        const countElement = document.getElementById('customerCount');
        countElement.textContent = `${count} customer${count !== 1 ? 's' : ''}`;
    }

    // Export data to CSV
    exportData() {
        if (this.customers.length === 0) {
            alert('No customers to export!');
            return;
        }

        const headers = [
            'Date', 'Customer', 'Email', 'Number', 'Address', 'Package', 'Size', 
            'Add-ons', 'Price', 'Time', 'End-Time', 'Heard From', 'Notes', 
            'Date Added', 'Last Modified'
        ];

        const csvContent = [
            headers.join(','),
            ...this.customers.map(customer => [
                customer.date,
                this.escapeCsvField(customer.customer),
                this.escapeCsvField(customer.email),
                this.escapeCsvField(customer.number || ''),
                this.escapeCsvField(customer.address || ''),
                this.escapeCsvField(customer.package || ''),
                this.escapeCsvField(customer.size || ''),
                this.escapeCsvField(customer.addOns || ''),
                customer.price || '',
                customer.time || '',
                customer.endTime || '',
                this.escapeCsvField(customer.heardFrom || ''),
                this.escapeCsvField(customer.notes || ''),
                customer.dateAdded,
                customer.lastModified
            ].join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        
        link.setAttribute('href', url);
        link.setAttribute('download', `customer-database-${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        this.showNotification('Customer data exported successfully!');
    }

    // Toggle Google Sheets import section
    toggleSheetsImport() {
        const section = document.getElementById('sheetsImportSection');
        const button = document.getElementById('importFromSheets');
        
        if (section.classList.contains('hidden')) {
            section.classList.remove('hidden');
            button.textContent = 'Hide Import';
            button.style.background = '#dc3545';
        } else {
            section.classList.add('hidden');
            button.textContent = 'Import from Google Sheets';
            button.style.background = '#4285f4';
        }
    }

    // Cancel Google Sheets import
    cancelSheetsImport() {
        this.toggleSheetsImport();
        document.getElementById('importPreview').classList.add('hidden');
        document.getElementById('executeImport').disabled = true;
        this.previewData = null;
    }

    // Convert Google Sheets URL to CSV export URL
    convertSheetsUrlToCsv(url) {
        try {
            // Extract spreadsheet ID and gid from the URL
            const spreadsheetMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
            const gidMatch = url.match(/[#&]gid=([0-9]+)/);
            
            if (!spreadsheetMatch) {
                throw new Error('Invalid Google Sheets URL');
            }
            
            const spreadsheetId = spreadsheetMatch[1];
            const gid = gidMatch ? gidMatch[1] : '0';
            
            return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
        } catch (error) {
            throw new Error('Could not parse Google Sheets URL. Please check the URL format.');
        }
    }

    // Parse CSV data
    parseCSV(csvText) {
        const rows = [];
        const lines = csvText.split('\n');
        
        for (const line of lines) {
            if (line.trim()) {
                // Simple CSV parser - handles quoted fields
                const row = [];
                let current = '';
                let inQuotes = false;
                
                for (let i = 0; i < line.length; i++) {
                    const char = line[i];
                    const nextChar = line[i + 1];
                    
                    if (char === '"' && inQuotes && nextChar === '"') {
                        current += '"';
                        i++; // Skip next quote
                    } else if (char === '"') {
                        inQuotes = !inQuotes;
                    } else if (char === ',' && !inQuotes) {
                        row.push(current.trim());
                        current = '';
                    } else {
                        current += char;
                    }
                }
                row.push(current.trim());
                rows.push(row);
            }
        }
        
        return rows;
    }

    // Get column value by letter or name
    getColumnValue(row, columnRef, headers = null) {
        if (!columnRef) return '';
        
        columnRef = columnRef.toString().trim();
        
        // If it's a letter (A, B, C, etc.)
        if (/^[A-Z]+$/i.test(columnRef)) {
            const colIndex = this.columnLetterToIndex(columnRef.toUpperCase());
            return row[colIndex] || '';
        }
        
        // If it's a number (1, 2, 3, etc.)
        if (/^\d+$/.test(columnRef)) {
            const colIndex = parseInt(columnRef) - 1;
            return row[colIndex] || '';
        }
        
        // If it's a column name and we have headers
        if (headers) {
            const colIndex = headers.findIndex(header => 
                header.toLowerCase().includes(columnRef.toLowerCase())
            );
            return colIndex !== -1 ? row[colIndex] || '' : '';
        }
        
        return '';
    }

    // Convert column letter to index (A=0, B=1, etc.)
    columnLetterToIndex(letter) {
        let result = 0;
        for (let i = 0; i < letter.length; i++) {
            result = result * 26 + (letter.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
        }
        return result - 1;
    }

    // Preview Google Sheets import
    async previewSheetsImport(silent = false) {
        try {
            const url = document.getElementById('sheetsUrl').value.trim();
            if (!url) {
                if (!silent) alert('Please enter a Google Sheets URL');
                return;
            }

            if (!silent) this.showNotification('Fetching data from Google Sheets...');
            
            // Convert to CSV export URL
            const csvUrl = this.convertSheetsUrlToCsv(url);
            console.log('Attempting to fetch from:', csvUrl);
            
            let csvText = '';
            
            // Try multiple methods to fetch the data
            try {
                // Method 1: Try direct fetch first
                const directResponse = await fetch(csvUrl);
                if (directResponse.ok) {
                    csvText = await directResponse.text();
                    console.log('Direct fetch successful');
                } else {
                    throw new Error('Direct fetch failed');
                }
            } catch (directError) {
                console.log('Direct fetch failed, trying CORS proxy...');
                
                // Method 2: Try CORS proxy
                try {
                    const proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(csvUrl);
                    const proxyResponse = await fetch(proxyUrl);
                    if (proxyResponse.ok) {
                        csvText = await proxyResponse.text();
                        console.log('CORS proxy fetch successful');
                    } else {
                        throw new Error('CORS proxy fetch failed');
                    }
                } catch (proxyError) {
                    console.log('CORS proxy failed, trying alternative proxy...');
                    
                    // Method 3: Try alternative proxy
                    try {
                        const altProxyUrl = 'https://corsproxy.io/?' + encodeURIComponent(csvUrl);
                        const altResponse = await fetch(altProxyUrl);
                        if (altResponse.ok) {
                            csvText = await altResponse.text();
                            console.log('Alternative proxy fetch successful');
                        } else {
                            throw new Error('All fetch methods failed');
                        }
                    } catch (altError) {
                        // If all methods fail, show manual import option
                        this.showManualImportOption();
                        return;
                    }
                }
            }
            
            if (!csvText || csvText.trim() === '') {
                throw new Error('No data received from the spreadsheet');
            }

            console.log('CSV data received, length:', csvText.length);
            const rows = this.parseCSV(csvText);
            console.log('Parsed rows:', rows.length);
            
            if (rows.length === 0) {
                throw new Error('No data found in the spreadsheet');
            }

            // Get mapping configuration
            const mapping = this.getCurrentMapping();
            console.log('Using mapping:', mapping);

            const startRow = parseInt(document.getElementById('startRow').value) - 1;
            const maxRows = parseInt(document.getElementById('maxRows').value);
            const skipDuplicates = document.getElementById('skipDuplicates').checked;

            // Process the data
            const headers = rows[0] || [];
            console.log('Headers:', headers);
            
            const dataRows = rows.slice(startRow, Math.min(rows.length, startRow + maxRows));
            console.log('Processing', dataRows.length, 'data rows');
            
            const processedData = [];
            let newCount = 0;
            let duplicateCount = 0;
            let errorCount = 0;

            for (let i = 0; i < dataRows.length; i++) {
                const row = dataRows[i];
                try {
                    const customerData = {
                        date: this.getColumnValue(row, mapping.date, headers) || new Date().toISOString().split('T')[0],
                        customer: this.getColumnValue(row, mapping.customer, headers),
                        email: this.getColumnValue(row, mapping.email, headers),
                        number: this.getColumnValue(row, mapping.number, headers),
                        package: this.getColumnValue(row, mapping.package, headers),
                        size: this.getColumnValue(row, mapping.size, headers),
                        addOns: this.getColumnValue(row, mapping.addOns, headers),
                        price: this.getColumnValue(row, mapping.price, headers),
                        time: this.getColumnValue(row, mapping.time, headers),
                        endTime: this.getColumnValue(row, mapping.endTime, headers),
                        heardFrom: this.getColumnValue(row, mapping.heardFrom, headers),
                        address: this.getColumnValue(row, mapping.address, headers),
                        notes: `Imported from Google Sheets on ${new Date().toLocaleDateString()}`,
                        id: this.generateId(),
                        dateAdded: new Date().toISOString().split('T')[0],
                        lastModified: new Date().toISOString().split('T')[0]
                    };

                    console.log('Processing customer:', customerData.customer, customerData.email);

                    // Validation
                    if (!customerData.customer || !customerData.email) {
                        console.log('Skipping row due to missing customer name or email:', row);
                        errorCount++;
                        continue;
                    }

                    // Check for duplicates
                    const existingCustomer = this.customers.find(c => 
                        c.email.toLowerCase() === customerData.email.toLowerCase()
                    );

                    if (existingCustomer && skipDuplicates) {
                        duplicateCount++;
                        customerData.status = 'duplicate';
                    } else {
                        newCount++;
                        customerData.status = 'new';
                    }

                    processedData.push(customerData);
                } catch (error) {
                    console.error('Error processing row:', row, error);
                    errorCount++;
                }
            }

            console.log('Processing complete:', { newCount, duplicateCount, errorCount });
            this.previewData = processedData;
            
            if (!silent) {
                this.showImportPreview(processedData, newCount, duplicateCount, errorCount);
                document.getElementById('executeImport').disabled = false;
                this.showNotification(`Preview ready: ${newCount} new, ${duplicateCount} duplicates, ${errorCount} errors`);
            }

        } catch (error) {
            console.error('Import preview error:', error);
            if (!silent) {
                this.showErrorDialog(error);
            }
        }
    }

    // Get current mapping configuration
    getCurrentMapping() {
        return {
            date: document.getElementById('mapDate').value,
            customer: document.getElementById('mapCustomer').value,
            email: document.getElementById('mapEmail').value,
            number: document.getElementById('mapNumber').value,
            package: document.getElementById('mapPackage').value,
            size: document.getElementById('mapSize').value,
            addOns: document.getElementById('mapAddOns').value,
            price: document.getElementById('mapPrice').value,
            time: document.getElementById('mapTime').value,
            endTime: document.getElementById('mapEndTime').value,
            heardFrom: document.getElementById('mapHeardFrom').value,
            address: document.getElementById('mapAddress').value
        };
    }

    // Show manual import option when automatic import fails
    showManualImportOption() {
        const previewContent = document.getElementById('previewContent');
        previewContent.innerHTML = `
            <div class="manual-import-info">
                <h4>⚠️ Automatic Import Not Available</h4>
                <p>We couldn't automatically access your Google Sheets. This can happen due to:</p>
                <ul>
                    <li>Sheet privacy settings</li>
                    <li>Browser security restrictions</li>
                    <li>Network limitations</li>
                </ul>
                
                <h4>📋 Manual Import Instructions:</h4>
                <ol>
                    <li><strong>Open your Google Sheet</strong></li>
                    <li><strong>Select all your data</strong> (Ctrl+A or Cmd+A)</li>
                    <li><strong>Copy the data</strong> (Ctrl+C or Cmd+C)</li>
                    <li><strong>Paste it in the text area below</strong></li>
                    <li><strong>Click "Process Manual Import"</strong></li>
                </ol>
                
                <div class="manual-import-area">
                    <label for="manualData">Paste your Google Sheets data here:</label>
                    <textarea id="manualData" rows="10" placeholder="Paste your copied Google Sheets data here..."></textarea>
                    <div class="manual-import-actions">
                        <button id="processManualImport" class="btn-primary">Process Manual Import</button>
                        <button id="downloadTemplate" class="btn-secondary">Download CSV Template</button>
                    </div>
                </div>
            </div>
        `;

        // Add event listeners for manual import
        document.getElementById('processManualImport').addEventListener('click', () => {
            this.processManualImport();
        });

        document.getElementById('downloadTemplate').addEventListener('click', () => {
            this.downloadTemplate();
        });

        document.getElementById('importPreview').classList.remove('hidden');
    }

    // Process manual import
    processManualImport() {
        try {
            const manualData = document.getElementById('manualData').value.trim();
            if (!manualData) {
                alert('Please paste your Google Sheets data in the text area');
                return;
            }

            console.log('Processing manual import data...');
            const rows = this.parseCSV(manualData);
            
            if (rows.length === 0) {
                alert('No valid data found. Please check your copied data and try again.');
                return;
            }

            // Process the data same as automatic import
            const mapping = this.getCurrentMapping();
            const startRow = parseInt(document.getElementById('startRow').value) - 1;
            const maxRows = parseInt(document.getElementById('maxRows').value);
            const skipDuplicates = document.getElementById('skipDuplicates').checked;

            const headers = rows[0] || [];
            const dataRows = rows.slice(startRow, Math.min(rows.length, startRow + maxRows));
            const processedData = [];
            let newCount = 0;
            let duplicateCount = 0;
            let errorCount = 0;

            for (const row of dataRows) {
                try {
                    const customerData = {
                        date: this.getColumnValue(row, mapping.date, headers) || new Date().toISOString().split('T')[0],
                        customer: this.getColumnValue(row, mapping.customer, headers),
                        email: this.getColumnValue(row, mapping.email, headers),
                        number: this.getColumnValue(row, mapping.number, headers),
                        package: this.getColumnValue(row, mapping.package, headers),
                        size: this.getColumnValue(row, mapping.size, headers),
                        addOns: this.getColumnValue(row, mapping.addOns, headers),
                        price: this.getColumnValue(row, mapping.price, headers),
                        time: this.getColumnValue(row, mapping.time, headers),
                        endTime: this.getColumnValue(row, mapping.endTime, headers),
                        heardFrom: this.getColumnValue(row, mapping.heardFrom, headers),
                        address: this.getColumnValue(row, mapping.address, headers),
                        notes: `Manually imported on ${new Date().toLocaleDateString()}`,
                        id: this.generateId(),
                        dateAdded: new Date().toISOString().split('T')[0],
                        lastModified: new Date().toISOString().split('T')[0]
                    };

                    if (!customerData.customer || !customerData.email) {
                        errorCount++;
                        continue;
                    }

                    const existingCustomer = this.customers.find(c => 
                        c.email.toLowerCase() === customerData.email.toLowerCase()
                    );

                    if (existingCustomer && skipDuplicates) {
                        duplicateCount++;
                        customerData.status = 'duplicate';
                    } else {
                        newCount++;
                        customerData.status = 'new';
                    }

                    processedData.push(customerData);
                } catch (error) {
                    errorCount++;
                }
            }

            this.previewData = processedData;
            this.showImportPreview(processedData, newCount, duplicateCount, errorCount);
            document.getElementById('executeImport').disabled = false;
            this.showNotification(`Manual import processed: ${newCount} new, ${duplicateCount} duplicates, ${errorCount} errors`);

        } catch (error) {
            console.error('Manual import error:', error);
            alert('Error processing manual import: ' + error.message);
        }
    }

    // Test import functionality with sample data
    testImport() {
        console.log('Running test import...');
        
        // Create sample CSV data
        const sampleData = `Date,Customer,Email,Number,Package,Size,Add-ons,Price,Time,End-Time,Heard From,Address
2024-10-30,Test Customer 1,test1@email.com,555-0001,Premium,Large,Express delivery,299.99,10:00,12:00,Google,123 Test St
2024-10-30,Test Customer 2,test2@email.com,555-0002,Standard,Medium,Gift wrapping,149.99,14:00,16:00,Facebook,456 Demo Ave
2024-10-30,Test Customer 3,test3@email.com,555-0003,Basic,Small,,99.99,09:00,11:00,Referral,789 Sample Rd`;

        console.log('Sample data created, processing...');
        
        try {
            // Parse the sample data
            const rows = this.parseCSV(sampleData);
            console.log('Parsed sample rows:', rows);
            
            // Use the current mapping
            const mapping = this.getCurrentMapping();
            console.log('Using mapping:', mapping);
            
            const headers = rows[0];
            const dataRows = rows.slice(1);
            const processedData = [];
            let newCount = 0;
            let duplicateCount = 0;
            let errorCount = 0;

            for (const row of dataRows) {
                try {
                    const customerData = {
                        date: this.getColumnValue(row, mapping.date, headers) || new Date().toISOString().split('T')[0],
                        customer: this.getColumnValue(row, mapping.customer, headers),
                        email: this.getColumnValue(row, mapping.email, headers),
                        number: this.getColumnValue(row, mapping.number, headers),
                        package: this.getColumnValue(row, mapping.package, headers),
                        size: this.getColumnValue(row, mapping.size, headers),
                        addOns: this.getColumnValue(row, mapping.addOns, headers),
                        price: this.getColumnValue(row, mapping.price, headers),
                        time: this.getColumnValue(row, mapping.time, headers),
                        endTime: this.getColumnValue(row, mapping.endTime, headers),
                        heardFrom: this.getColumnValue(row, mapping.heardFrom, headers),
                        address: this.getColumnValue(row, mapping.address, headers),
                        notes: `Test import on ${new Date().toLocaleDateString()}`,
                        id: this.generateId(),
                        dateAdded: new Date().toISOString().split('T')[0],
                        lastModified: new Date().toISOString().split('T')[0]
                    };

                    console.log('Test customer data:', customerData);

                    if (!customerData.customer || !customerData.email) {
                        errorCount++;
                        continue;
                    }

                    const existingCustomer = this.customers.find(c => 
                        c.email.toLowerCase() === customerData.email.toLowerCase()
                    );

                    if (existingCustomer) {
                        duplicateCount++;
                        customerData.status = 'duplicate';
                    } else {
                        newCount++;
                        customerData.status = 'new';
                    }

                    processedData.push(customerData);
                } catch (error) {
                    console.error('Error processing test row:', error);
                    errorCount++;
                }
            }

            console.log('Test processing complete:', { newCount, duplicateCount, errorCount });
            
            this.previewData = processedData;
            this.showImportPreview(processedData, newCount, duplicateCount, errorCount);
            document.getElementById('executeImport').disabled = false;
            this.showNotification(`Test data ready: ${newCount} new, ${duplicateCount} duplicates, ${errorCount} errors`);

        } catch (error) {
            console.error('Test import error:', error);
            alert('Test import failed: ' + error.message);
        }
    }

    // Download CSV template
    downloadTemplate() {
        const headers = ['Date', 'Customer', 'Email', 'Number', 'Package', 'Size', 'Add-ons', 'Price', 'Time', 'End-Time', 'Heard From', 'Address'];
        const sampleData = [
            '2024-10-30', 'John Smith', 'john@email.com', '555-1234', 'Premium', 'Large', 'Express delivery', '299.99', '10:00', '12:00', 'Google', '123 Main St, City, State'
        ];
        
        const csvContent = [headers.join(','), sampleData.join(',')].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        
        link.setAttribute('href', url);
        link.setAttribute('download', 'customer-import-template.csv');
        link.style.visibility = 'hidden';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // Show error dialog with helpful information
    showErrorDialog(error) {
        const errorMessage = `
Import Error: ${error.message}

Possible solutions:
1. Make sure your Google Sheet is set to "Anyone with the link can view"
2. Check that the URL is correct and accessible
3. Try the manual import option below
4. Ensure your internet connection is stable

Would you like to try manual import instead?`;

        if (confirm(errorMessage)) {
            this.showManualImportOption();
        }
    }

    // Show import preview
    showImportPreview(data, newCount, duplicateCount, errorCount) {
        const previewSection = document.getElementById('importPreview');
        const previewContent = document.getElementById('previewContent');

        const statsHtml = `
            <div class="preview-stats">
                <div class="stat-item stat-new">New Records: ${newCount}</div>
                <div class="stat-item stat-duplicate">Duplicates: ${duplicateCount}</div>
                <div class="stat-item stat-error">Errors: ${errorCount}</div>
                <div class="stat-item">Total Processed: ${data.length}</div>
            </div>
        `;

        const tableHtml = `
            <table class="preview-table">
                <thead>
                    <tr>
                        <th>Status</th>
                        <th>Customer</th>
                        <th>Email</th>
                        <th>Package</th>
                        <th>Price</th>
                        <th>Date</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.slice(0, 10).map(customer => `
                        <tr>
                            <td><span class="status-badge ${customer.status}">${customer.status}</span></td>
                            <td>${customer.customer}</td>
                            <td>${customer.email}</td>
                            <td>${customer.package || 'N/A'}</td>
                            <td>${customer.price ? '$' + customer.price : 'N/A'}</td>
                            <td>${customer.date}</td>
                        </tr>
                    `).join('')}
                    ${data.length > 10 ? `<tr><td colspan="6"><em>... and ${data.length - 10} more records</em></td></tr>` : ''}
                </tbody>
            </table>
        `;

        previewContent.innerHTML = statsHtml + tableHtml;
        previewSection.classList.remove('hidden');
    }

    // Execute Google Sheets import
    async executeSheetsImport(silent = false) {
        if (!this.previewData) {
            if (!silent) alert('Please preview the import first');
            return;
        }

        const updateExisting = document.getElementById('updateExisting').checked;
        const skipDuplicates = document.getElementById('skipDuplicates').checked;
        
        let importedCount = 0;
        let updatedCount = 0;
        let skippedCount = 0;

        for (const customerData of this.previewData) {
            if (customerData.status === 'duplicate') {
                const existingIndex = this.customers.findIndex(c => 
                    c.email.toLowerCase() === customerData.email.toLowerCase()
                );

                if (updateExisting && existingIndex !== -1) {
                    // Update existing customer
                    this.customers[existingIndex] = { ...this.customers[existingIndex], ...customerData };
                    updatedCount++;
                } else {
                    skippedCount++;
                }
            } else if (customerData.status === 'new') {
                // Add new customer
                delete customerData.status;
                this.customers.push(customerData);
                importedCount++;
            }
        }

        this.saveCustomers();
        this.renderCustomers();
        this.updateCustomerCount();
        
        if (!silent) {
            this.cancelSheetsImport();
        }

        const message = `Import completed! ${importedCount} new customers added, ${updatedCount} updated, ${skippedCount} skipped`;
        
        if (!silent) {
            this.showNotification(message);
        }
        
        return { importedCount, updatedCount, skippedCount };
    }

    // Escape CSV field
    escapeCsvField(field) {
        if (field.includes(',') || field.includes('"') || field.includes('\n')) {
            return `"${field.replace(/"/g, '""')}"`;
        }
        return field;
    }

    // Show notification
    showNotification(message) {
        // Create a simple notification
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #28a745;
            color: white;
            padding: 15px 20px;
            border-radius: 5px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            z-index: 10000;
            font-weight: 600;
            max-width: 300px;
        `;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        // Remove notification after 3 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 3000);
    }

    // Add sample data (for demonstration)
    addSampleData() {
        const sampleCustomers = [
            {
                id: this.generateId(),
                date: '2024-10-25',
                customer: 'John Smith',
                email: 'john.smith@email.com',
                number: '(555) 123-4567',
                address: '123 Main St, New York, NY 10001',
                package: 'Premium',
                size: 'Large',
                addOns: 'Express delivery, Gift wrapping',
                price: '299.99',
                time: '10:00',
                endTime: '12:00',
                heardFrom: 'Google',
                notes: 'Excellent customer, always pays on time.',
                dateAdded: '2024-01-15',
                lastModified: '2024-10-25'
            },
            {
                id: this.generateId(),
                date: '2024-10-28',
                customer: 'Sarah Johnson',
                email: 'sarah.johnson@email.com',
                number: '(555) 987-6543',
                address: '456 Oak Ave, Los Angeles, CA 90210',
                package: 'Standard',
                size: 'Medium',
                addOns: 'Additional customization',
                price: '149.99',
                time: '14:30',
                endTime: '16:00',
                heardFrom: 'Referral',
                notes: 'Interested in premium services for next order.',
                dateAdded: '2024-02-01',
                lastModified: '2024-10-28'
            }
        ];

        if (this.customers.length === 0) {
            this.customers = sampleCustomers;
            this.saveCustomers();
            this.renderCustomers();
            this.updateCustomerCount();
        }
    }
}

// Initialize the application when the page loads
document.addEventListener('DOMContentLoaded', () => {
    const database = new CustomerDatabase();
    
    // Add sample data if no customers exist (for demonstration)
    // You can remove this line in production
    database.addSampleData();
    
    // Check if auto-sync was previously enabled
    const autoSyncEnabled = localStorage.getItem('autoSyncEnabled');
    if (autoSyncEnabled === 'true') {
        database.enableAutoSync();
    }
    
    // Make database globally accessible for debugging
    window.customerDatabase = database;
});
