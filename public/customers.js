// Customer Dashboard JavaScript

class CustomerDashboard {
    constructor() {
        this.customers = [];
        this.filteredCustomers = [];
        this.currentCustomer = null;
        this.init();
    }

    init() {
        this.bindEvents();
        this.loadCustomers();
    }

    bindEvents() {
        // Search functionality
        document.getElementById('searchInput').addEventListener('input', (e) => {
            this.debounce(this.searchCustomers.bind(this), 300)(e.target.value);
        });
        
        document.getElementById('searchBtn').addEventListener('click', () => {
            const searchTerm = document.getElementById('searchInput').value;
            this.searchCustomers(searchTerm);
        });
        
        document.getElementById('clearSearchBtn').addEventListener('click', () => {
            document.getElementById('searchInput').value = '';
            this.searchCustomers('');
        });

        // Add customer form
        document.getElementById('toggleAddFormBtn').addEventListener('click', () => {
            this.toggleAddForm();
        });
        
        document.getElementById('cancelAddBtn').addEventListener('click', () => {
            this.hideAddForm();
        });
        
        document.getElementById('addCustomerForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addCustomer();
        });

        // Modal events
        document.getElementById('closeModal').addEventListener('click', () => {
            this.hideModal();
        });
        
        document.getElementById('closeModalBtn').addEventListener('click', () => {
            this.hideModal();
        });
        
        document.getElementById('customerModal').addEventListener('click', (e) => {
            if (e.target.id === 'customerModal') {
                this.hideModal();
            }
        });

        // Edit customer
        document.getElementById('editCustomerBtn').addEventListener('click', () => {
            this.editCustomer();
        });

        // Sync from bookings
        document.getElementById('syncFromBookingsBtn').addEventListener('click', () => {
            this.syncFromBookings();
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideModal();
                this.hideAddForm();
            }
        });
    }

    async loadCustomers() {
        try {
            this.showLoading();
            const response = await fetch('/api/customers');
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            this.customers = data.customers || [];
            this.filteredCustomers = [...this.customers];
            this.updateCustomerTable();
            this.updateCustomerCount();
            
            // Show demo data message if applicable
            if (data.isDemoData) {
                this.showMessage('Using demo data - Connect Google Apps Script for live data', 'info');
            }
            
        } catch (error) {
            console.error('Error loading customers:', error);
            this.showMessage('Error loading customers. Using demo data.', 'error');
            
            // Fallback to demo data if API fails
            this.customers = [
                {
                    id: '1',
                    name: 'Demo Customer 1',
                    email: 'demo1@example.com',
                    phone: '(555) 123-4567',
                    address: '123 Demo St',
                    city: 'Demo City',
                    state: 'CA',
                    zip: '12345',
                    vehicleInfo: '2020 Honda Civic',
                    notes: 'Demo data',
                    totalServices: 2,
                    lastService: '2024-10-15'
                },
                {
                    id: '2',
                    name: 'Demo Customer 2',
                    email: 'demo2@example.com',
                    phone: '(555) 987-6543',
                    address: '456 Demo Ave',
                    city: 'Demo Town',
                    state: 'CA',
                    zip: '67890',
                    vehicleInfo: '2019 Toyota Camry',
                    notes: 'Another demo customer',
                    totalServices: 1,
                    lastService: '2024-09-20'
                }
            ];
            this.filteredCustomers = [...this.customers];
            this.updateCustomerTable();
            this.updateCustomerCount();
        } finally {
            this.hideLoading();
        }
    }

    searchCustomers(searchTerm) {
        if (!searchTerm.trim()) {
            this.filteredCustomers = [...this.customers];
        } else {
            const term = searchTerm.toLowerCase();
            this.filteredCustomers = this.customers.filter(customer => {
                return (
                    (customer.name && customer.name.toLowerCase().includes(term)) ||
                    (customer.email && customer.email.toLowerCase().includes(term)) ||
                    (customer.phone && customer.phone.toLowerCase().includes(term)) ||
                    (customer.address && customer.address.toLowerCase().includes(term)) ||
                    (customer.city && customer.city.toLowerCase().includes(term)) ||
                    (customer.state && customer.state.toLowerCase().includes(term)) ||
                    (customer.vehicleInfo && customer.vehicleInfo.toLowerCase().includes(term))
                );
            });
        }
        this.updateCustomerTable();
        this.updateCustomerCount();
    }

    updateCustomerTable() {
        const tbody = document.getElementById('customerTableBody');
        
        if (this.filteredCustomers.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="loading-cell">No customers found</td></tr>';
            return;
        }

        tbody.innerHTML = this.filteredCustomers.map(customer => {
            const lastService = customer.lastService || 'Never';
            const totalServices = customer.totalServices || 0;
            const phone = customer.phone || '-';
            const address = this.formatAddress(customer);
            const vehicle = customer.vehicleInfo || '-';

            return `
                <tr class="customer-row" data-customer-id="${customer.id}">
                    <td class="font-weight-bold">${this.escapeHtml(customer.name)}</td>
                    <td>${this.escapeHtml(customer.email)}</td>
                    <td>${this.escapeHtml(phone)}</td>
                    <td>${this.escapeHtml(address)}</td>
                    <td>${this.escapeHtml(vehicle)}</td>
                    <td>${lastService}</td>
                    <td>${totalServices}</td>
                    <td class="customer-actions">
                        <button class="btn btn-primary btn-small" onclick="dashboard.viewCustomer('${customer.id}')">
                            View
                        </button>
                        <button class="btn btn-secondary btn-small" onclick="dashboard.editCustomer('${customer.id}')">
                            Edit
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

        // Add click events to rows
        tbody.querySelectorAll('.customer-row').forEach(row => {
            row.addEventListener('click', (e) => {
                if (!e.target.classList.contains('btn')) {
                    const customerId = row.dataset.customerId;
                    this.viewCustomer(customerId);
                }
            });
        });
    }

    formatAddress(customer) {
        const parts = [];
        if (customer.address) parts.push(customer.address);
        if (customer.city) parts.push(customer.city);
        if (customer.state) parts.push(customer.state);
        if (customer.zip) parts.push(customer.zip);
        return parts.join(', ') || '-';
    }

    updateCustomerCount() {
        const total = this.customers.length;
        const filtered = this.filteredCustomers.length;
        const countText = filtered === total 
            ? `${total} customer${total !== 1 ? 's' : ''}`
            : `${filtered} of ${total} customers`;
        document.getElementById('customerCount').textContent = countText;
    }

    toggleAddForm() {
        const form = document.getElementById('addCustomerForm');
        const btn = document.getElementById('toggleAddFormBtn');
        
        if (form.classList.contains('hidden')) {
            form.classList.remove('hidden');
            btn.textContent = 'Cancel';
            document.getElementById('customerName').focus();
        } else {
            this.hideAddForm();
        }
    }

    hideAddForm() {
        const form = document.getElementById('addCustomerForm');
        const btn = document.getElementById('toggleAddFormBtn');
        
        form.classList.add('hidden');
        btn.textContent = '+ Add Customer';
        form.reset();
    }

    async addCustomer() {
        try {
            this.showLoading();
            
            const formData = new FormData(document.getElementById('addCustomerForm'));
            const customerData = Object.fromEntries(formData.entries());
            
            // Validation
            if (!customerData.name || !customerData.email) {
                this.showMessage('Name and email are required fields.', 'error');
                return;
            }

            const response = await fetch('/api/customers', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(customerData)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            
            if (result.success) {
                if (result.isDemoMode) {
                    this.showMessage('Demo Mode: ' + result.message, 'info');
                } else {
                    this.showMessage('Customer added successfully!', 'success');
                }
                this.hideAddForm();
                this.loadCustomers(); // Reload the customer list
            } else {
                this.showMessage(result.message || 'Error adding customer', 'error');
            }
            
        } catch (error) {
            console.error('Error adding customer:', error);
            this.showMessage('Error adding customer. Please try again.', 'error');
        } finally {
            this.hideLoading();
        }
    }

    async viewCustomer(customerId) {
        try {
            this.showLoading();
            
            const response = await fetch(`/api/customers/${customerId}`);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            this.currentCustomer = data.customer;
            this.showCustomerModal(data.customer, data.bookings || []);
            
        } catch (error) {
            console.error('Error loading customer details:', error);
            this.showMessage('Error loading customer details.', 'error');
        } finally {
            this.hideLoading();
        }
    }

    showCustomerModal(customer, bookings) {
        document.getElementById('modalCustomerName').textContent = customer.name;
        
        const detailsHtml = `
            <div class="detail-grid">
                <div class="detail-item">
                    <div class="detail-label">Email</div>
                    <div class="detail-value">${this.escapeHtml(customer.email)}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Phone</div>
                    <div class="detail-value">${this.escapeHtml(customer.phone || '-')}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Address</div>
                    <div class="detail-value">${this.escapeHtml(this.formatAddress(customer))}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Vehicle</div>
                    <div class="detail-value">${this.escapeHtml(customer.vehicleInfo || '-')}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Customer Since</div>
                    <div class="detail-value">${customer.createdDate || '-'}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Total Services</div>
                    <div class="detail-value">${customer.totalServices || 0}</div>
                </div>
            </div>
            ${customer.notes ? `
                <div class="detail-item" style="margin-top: 1rem;">
                    <div class="detail-label">Notes</div>
                    <div class="detail-value">${this.escapeHtml(customer.notes)}</div>
                </div>
            ` : ''}
        `;
        
        document.getElementById('customerDetails').innerHTML = detailsHtml;
        
        const bookingsHtml = bookings.length > 0 
            ? bookings.map(booking => `
                <div class="booking-item">
                    <div class="booking-date">${booking.date || 'Unknown Date'}</div>
                    <div class="booking-service">${this.escapeHtml(booking.service || 'Service details not available')}</div>
                    ${booking.amount ? `<div class="booking-amount">$${booking.amount}</div>` : ''}
                </div>
            `).join('')
            : '<div class="text-muted">No booking history found.</div>';
        
        document.getElementById('bookingsList').innerHTML = bookingsHtml;
        document.getElementById('customerModal').classList.remove('hidden');
    }

    hideModal() {
        document.getElementById('customerModal').classList.add('hidden');
        this.currentCustomer = null;
    }

    async syncFromBookings() {
        try {
            this.showLoading();
            
            const response = await fetch('/api/customers/sync-from-bookings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            
            if (result.success) {
                if (result.isDemoMode) {
                    this.showMessage('Demo Mode: ' + result.message, 'info');
                } else {
                    this.showMessage(result.message, 'success');
                    this.loadCustomers(); // Reload the customer list
                }
            } else {
                this.showMessage(result.message || 'Error syncing customers', 'error');
            }
            
        } catch (error) {
            console.error('Error syncing customers from bookings:', error);
            this.showMessage('Error syncing customers from bookings. Please try again.', 'error');
        } finally {
            this.hideLoading();
        }
    }

    editCustomer(customerId) {
        // For now, we'll show a simple alert
        // In a full implementation, you'd show an edit form
        this.showMessage('Edit functionality coming soon!', 'info');
    }

    showLoading() {
        document.getElementById('loadingSpinner').classList.remove('hidden');
    }

    hideLoading() {
        document.getElementById('loadingSpinner').classList.add('hidden');
    }

    showMessage(message, type = 'info') {
        const container = document.getElementById('messageContainer');
        const messageEl = document.createElement('div');
        messageEl.className = `message ${type}`;
        messageEl.textContent = message;
        
        container.appendChild(messageEl);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (messageEl.parentNode) {
                messageEl.parentNode.removeChild(messageEl);
            }
        }, 5000);
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
}

// Initialize the dashboard when the page loads
let dashboard;
document.addEventListener('DOMContentLoaded', () => {
    dashboard = new CustomerDashboard();
});

// Global functions for button onclick handlers
window.dashboard = {
    viewCustomer: (id) => dashboard.viewCustomer(id),
    editCustomer: (id) => dashboard.editCustomer(id)
};