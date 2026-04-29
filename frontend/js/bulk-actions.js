import { API_BASE_URL } from './config.js';
import { usersData, scansData } from './config.js';
import { loadAllData } from './data.js';
import { showNotification } from './notifications.js';

export function initBulkActions() {
    initBulkUserActions();
    initBulkScanActions();
}

function initBulkUserActions() {
    const usersHeader = document.querySelector('#users-tab thead tr');
    if (!usersHeader) return;

    // Add checkbox column
    const checkboxHeader = document.createElement('th');
    checkboxHeader.innerHTML = `
        <input type="checkbox" id="select-all-users" onchange="toggleAllUsers()">
    `;
    usersHeader.insertBefore(checkboxHeader, usersHeader.firstChild);

    // Add bulk actions bar
    const usersContainer = document.querySelector('#users-tab .content-header');
    if (usersContainer) {
        const bulkActionsHTML = `
            <div class="bulk-actions" id="bulk-user-actions" style="display: none;">
                <span class="selected-count">0 selected</span>
                <button class="btn-danger" onclick="bulkDeleteUsers()">
                    <i class="fas fa-trash"></i> Delete Selected
                </button>
                <button class="btn-secondary" onclick="clearUserSelection()">
                    <i class="fas fa-times"></i> Clear Selection
                </button>
            </div>
        `;
        usersContainer.insertAdjacentHTML('afterend', bulkActionsHTML);
    }
}

function initBulkScanActions() {
    const scansHeader = document.querySelector('#scans-tab thead tr');
    if (!scansHeader) return;

    // Add checkbox column
    const checkboxHeader = document.createElement('th');
    checkboxHeader.innerHTML = `
        <input type="checkbox" id="select-all-scans" onchange="toggleAllScans()">
    `;
    scansHeader.insertBefore(checkboxHeader, scansHeader.firstChild);

    // Add bulk actions bar
    const scansContainer = document.querySelector('#scans-tab .content-header');
    if (scansContainer) {
        const bulkActionsHTML = `
            <div class="bulk-actions" id="bulk-scan-actions" style="display: none;">
                <span class="selected-count">0 selected</span>
                <button class="btn-danger" onclick="bulkDeleteScans()">
                    <i class="fas fa-trash"></i> Delete Selected
                </button>
                <button class="btn-warning" onclick="bulkOldScans()">
                    <i class="fas fa-calendar-times"></i> Delete Old Scans
                </button>
                <button class="btn-secondary" onclick="clearScanSelection()">
                    <i class="fas fa-times"></i> Clear Selection
                </button>
            </div>
        `;
        scansContainer.insertAdjacentHTML('afterend', bulkActionsHTML);
    }
}

// Global functions for onclick handlers
window.toggleAllUsers = function() {
    const selectAll = document.getElementById('select-all-users');
    const checkboxes = document.querySelectorAll('#users-table-body input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = selectAll.checked);
    updateBulkUserActions();
};

window.toggleAllScans = function() {
    const selectAll = document.getElementById('select-all-scans');
    const checkboxes = document.querySelectorAll('#scans-table-body input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = selectAll.checked);
    updateBulkScanActions();
};

window.bulkDeleteUsers = async function() {
    const selected = getSelectedUsers();
    if (selected.length === 0) {
        showNotification('No users selected', 'warning');
        return;
    }

    if (!confirm(`Delete ${selected.length} user(s) and all their scans? This cannot be undone.`)) {
        return;
    }

    try {
        const promises = selected.map(email => 
            fetch(`${API_BASE_URL}/api/admin/users/${email}`, { method: 'DELETE' })
        );
        
        await Promise.all(promises);
        showNotification(`${selected.length} user(s) deleted successfully`, 'success');
        clearUserSelection();
        loadAllData();
    } catch (err) {
        showNotification('Error deleting users', 'error');
        console.error('Bulk delete error:', err);
    }
};

window.bulkDeleteScans = async function() {
    const selected = getSelectedScans();
    if (selected.length === 0) {
        showNotification('No scans selected', 'warning');
        return;
    }

    if (!confirm(`Delete ${selected.length} scan(s)? This cannot be undone.`)) {
        return;
    }

    try {
        const promises = selected.map(id => 
            fetch(`${API_BASE_URL}/api/admin/scans/${id}`, { method: 'DELETE' })
        );
        
        await Promise.all(promises);
        showNotification(`${selected.length} scan(s) deleted successfully`, 'success');
        clearScanSelection();
        loadAllData();
    } catch (err) {
        showNotification('Error deleting scans', 'error');
        console.error('Bulk delete error:', err);
    }
};

window.bulkOldScans = function() {
    const days = prompt('Delete scans older than how many days?', '30');
    if (!days || isNaN(days)) return;

    if (!confirm(`Delete all scans older than ${days} days? This cannot be undone.`)) {
        return;
    }

    // This would need a backend endpoint for bulk deletion by date
    showNotification('Bulk old scans deletion not implemented yet', 'info');
};

window.clearUserSelection = function() {
    document.querySelectorAll('#users-table-body input[type="checkbox"]').forEach(cb => cb.checked = false);
    document.getElementById('select-all-users').checked = false;
    updateBulkUserActions();
};

window.clearScanSelection = function() {
    document.querySelectorAll('#scans-table-body input[type="checkbox"]').forEach(cb => cb.checked = false);
    document.getElementById('select-all-scans').checked = false;
    updateBulkScanActions();
};

function getSelectedUsers() {
    const checkboxes = document.querySelectorAll('#users-table-body input[type="checkbox"]:checked');
    return Array.from(checkboxes).map(cb => cb.dataset.email);
}

function getSelectedScans() {
    const checkboxes = document.querySelectorAll('#scans-table-body input[type="checkbox"]:checked');
    return Array.from(checkboxes).map(cb => parseInt(cb.dataset.scanId));
}

function updateBulkUserActions() {
    const selected = getSelectedUsers();
    const bulkActions = document.getElementById('bulk-user-actions');
    const selectedCount = bulkActions?.querySelector('.selected-count');
    
    if (selected.length > 0) {
        bulkActions.style.display = 'flex';
        selectedCount.textContent = `${selected.length} selected`;
    } else {
        bulkActions.style.display = 'none';
    }
}

function updateBulkScanActions() {
    const selected = getSelectedScans();
    const bulkActions = document.getElementById('bulk-scan-actions');
    const selectedCount = bulkActions?.querySelector('.selected-count');
    
    if (selected.length > 0) {
        bulkActions.style.display = 'flex';
        selectedCount.textContent = `${selected.length} selected`;
    } else {
        bulkActions.style.display = 'none';
    }
}

// Export functions to be called from render functions
export function addCheckboxToUserRow(row, user) {
    const checkboxCell = document.createElement('td');
    checkboxCell.innerHTML = `<input type="checkbox" data-email="${user.email}" onchange="updateBulkUserActions()">`;
    row.insertBefore(checkboxCell, row.firstChild);
}

export function addCheckboxToScanRow(row, scan) {
    const checkboxCell = document.createElement('td');
    checkboxCell.innerHTML = `<input type="checkbox" data-scan-id="${scan.id}" onchange="updateBulkScanActions()">`;
    row.insertBefore(checkboxCell, row.firstChild);
}

// Make update functions global
window.updateBulkUserActions = updateBulkUserActions;
window.updateBulkScanActions = updateBulkScanActions;
