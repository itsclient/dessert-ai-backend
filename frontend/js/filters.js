import { usersData, scansData } from './config.js';
import { renderUsers } from './users.js';
import { renderScans } from './scans.js';

export function initAdvancedFilters() {
    initUserFilters();
    initScanFilters();
}

function initUserFilters() {
    const filterContainer = document.querySelector('#users-tab .content-header');
    if (!filterContainer) return;

    const filtersHTML = `
        <div class="filters-section">
            <div class="filter-group">
                <label>Registration Date:</label>
                <input type="date" id="user-date-from" placeholder="From">
                <input type="date" id="user-date-to" placeholder="To">
            </div>
            <div class="filter-group">
                <button class="btn-filter" onclick="applyUserFilters()">
                    <i class="fas fa-filter"></i> Apply Filters
                </button>
                <button class="btn-clear" onclick="clearUserFilters()">
                    <i class="fas fa-times"></i> Clear
                </button>
            </div>
        </div>
    `;

    filterContainer.insertAdjacentHTML('afterend', filtersHTML);
}

function initScanFilters() {
    const filterContainer = document.querySelector('#scans-tab .content-header');
    if (!filterContainer) return;

    const filtersHTML = `
        <div class="filters-section">
            <div class="filter-group">
                <label>Date Range:</label>
                <input type="date" id="scan-date-from" placeholder="From">
                <input type="date" id="scan-date-to" placeholder="To">
            </div>
            <div class="filter-group">
                <label>Category:</label>
                <select id="scan-category-filter">
                    <option value="">All Categories</option>
                    <option value="Cakes">Cakes</option>
                    <option value="Ice Cream">Ice Cream</option>
                    <option value="Cookies">Cookies</option>
                    <option value="Pastries">Pastries</option>
                    <option value="Other">Other</option>
                </select>
            </div>
            <div class="filter-group">
                <label>Calories:</label>
                <input type="number" id="calories-min" placeholder="Min" min="0">
                <input type="number" id="calories-max" placeholder="Max" min="0">
            </div>
            <div class="filter-group">
                <button class="btn-filter" onclick="applyScanFilters()">
                    <i class="fas fa-filter"></i> Apply Filters
                </button>
                <button class="btn-clear" onclick="clearScanFilters()">
                    <i class="fas fa-times"></i> Clear
                </button>
            </div>
        </div>
    `;

    filterContainer.insertAdjacentHTML('afterend', filtersHTML);
}

window.applyUserFilters = function() {
    const dateFrom = document.getElementById('user-date-from').value;
    const dateTo = document.getElementById('user-date-to').value;

    let filtered = [...usersData];

    if (dateFrom) {
        const fromDate = new Date(dateFrom);
        filtered = filtered.filter(user => {
            const userDate = new Date(user.created_at);
            return userDate >= fromDate;
        });
    }

    if (dateTo) {
        const toDate = new Date(dateTo);
        toDate.setHours(23, 59, 59, 999);
        filtered = filtered.filter(user => {
            const userDate = new Date(user.created_at);
            return userDate <= toDate;
        });
    }

    renderUsers(filtered);
};

window.clearUserFilters = function() {
    document.getElementById('user-date-from').value = '';
    document.getElementById('user-date-to').value = '';
    renderUsers(usersData);
};

window.applyScanFilters = function() {
    const dateFrom = document.getElementById('scan-date-from').value;
    const dateTo = document.getElementById('scan-date-to').value;
    const category = document.getElementById('scan-category-filter').value;
    const caloriesMin = document.getElementById('calories-min').value;
    const caloriesMax = document.getElementById('calories-max').value;

    let filtered = [...scansData];

    if (dateFrom) {
        const fromDate = new Date(dateFrom);
        filtered = filtered.filter(scan => {
            const scanDate = new Date(scan.scanned_at);
            return scanDate >= fromDate;
        });
    }

    if (dateTo) {
        const toDate = new Date(dateTo);
        toDate.setHours(23, 59, 59, 999);
        filtered = filtered.filter(scan => {
            const scanDate = new Date(scan.scanned_at);
            return scanDate <= toDate;
        });
    }

    if (category) {
        filtered = filtered.filter(scan => scan.category === category);
    }

    if (caloriesMin) {
        const min = parseInt(caloriesMin);
        filtered = filtered.filter(scan => (scan.calories || 0) >= min);
    }

    if (caloriesMax) {
        const max = parseInt(caloriesMax);
        filtered = filtered.filter(scan => (scan.calories || 0) <= max);
    }

    renderScans(filtered);
};

window.clearScanFilters = function() {
    document.getElementById('scan-date-from').value = '';
    document.getElementById('scan-date-to').value = '';
    document.getElementById('scan-category-filter').value = '';
    document.getElementById('calories-min').value = '';
    document.getElementById('calories-max').value = '';
    renderScans(scansData);
};
