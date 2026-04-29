import { API_BASE_URL } from './config.js';
import { loadAllData } from './data.js';
import { addCheckboxToUserRow } from './bulk-actions.js';
import { showNotification } from './notifications.js';

let usersData = [];
let scansData = [];

export function renderUsers(users) {
    const tbody = document.getElementById('users-table-body');
    tbody.innerHTML = '';

    if (!users || users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 40px;">No users found</td></tr>';
        return;
    }

    users.forEach(user => {
        const row = document.createElement('tr');
        const date = user.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A';

        row.innerHTML = `
            <td>${user.id}</td>
            <td><strong>${user.email}</strong></td>
            <td>${user.username || '-'}</td>
            <td>${user.name || '-'}</td>
            <td>${date}</td>
            <td>
                <button class="btn-view" onclick="viewUserDetail('${user.email}')">
                    <i class="fas fa-eye"></i> View
                </button>
                <button class="btn-delete" onclick="deleteUser('${user.email}')">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        `;
        
        addCheckboxToUserRow(row, user);
        tbody.appendChild(row);
    });
}

export async function deleteUser(email) {
    if (!confirm(`Delete user ${email} and all their scans? This cannot be undone.`)) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/users/${email}`, {
            method: 'DELETE'
        });

        const data = await response.json();
        if (data.success) {
            alert(`User ${email} has been deleted successfully.`);
            loadAllData();
        } else {
            alert('Failed to delete user: ' + (data.error || 'Unknown error'));
        }
    } catch (err) {
        console.error('Error deleting user:', err);
        alert('Error deleting user. Please try again.');
    }
}

export async function viewUserDetail(email) {
    try {
        // Fetch fresh user and scan data
        const [usersResponse, scansResponse] = await Promise.all([
            fetch(`${API_BASE_URL}/api/admin/users`),
            fetch(`${API_BASE_URL}/api/admin/scans`)
        ]);
        
        const usersData = await usersResponse.json();
        const scansData = await scansResponse.json();
        
        const user = usersData.users.find(u => u.email === email);
        if (!user) return;

        const userScans = scansData.scans.filter(s => s.user_email === email);
        const totalCalories = userScans.reduce((sum, s) => sum + (s.calories || 0), 0);
        const favoriteScans = userScans.filter(s => s.is_favorite).length;

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2><i class="fas fa-user"></i> User Profile: ${user.email}</h2>
                <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body">
                <div class="user-stats">
                    <div class="stat-box">
                        <i class="fas fa-camera"></i>
                        <span class="stat-value">${userScans.length}</span>
                        <span class="stat-label">Total Scans</span>
                    </div>
                    <div class="stat-box">
                        <i class="fas fa-fire"></i>
                        <span class="stat-value">${totalCalories}</span>
                        <span class="stat-label">Total Calories</span>
                    </div>
                    <div class="stat-box">
                        <i class="fas fa-heart"></i>
                        <span class="stat-value">${favoriteScans}</span>
                        <span class="stat-label">Favorites</span>
                    </div>
                </div>
                <h3>Recent Scans</h3>
                ${userScans.length === 0 ? '<p>No scans yet</p>' : `
                    <div class="user-scans-list">
                        ${userScans.map(scan => `
                            <div class="user-scan-item">
                                <img src="${scan.image_base64 || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22><rect fill=%22%23ccc%22 width=%22100%22 height=%22100%22/></svg>'}" alt="${scan.dessert_name}">
                                <div class="scan-info">
                                    <h4>${scan.dessert_name} ${scan.is_favorite ? '<i class="fas fa-heart" style="color: var(--primary);"></i>' : ''}</h4>
                                    <p><i class="fas fa-tag"></i> ${scan.category || 'Unknown'}</p>
                                    <p><i class="fas fa-fire"></i> ${scan.calories || 0} cal | <i class="fas fa-dumbbell"></i> ${scan.protein_grams || 0}g protein</p>
                                    <small>${new Date(scan.scanned_at).toLocaleString()}</small>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `}
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    } catch (error) {
        console.error('Error loading user details:', error);
        alert('Error loading user details. Please try again.');
    }
}

// Search functionality
export function initUserSearch() {
    document.getElementById('user-search')?.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = usersData.filter(u => 
            u.email.toLowerCase().includes(term) ||
            (u.username && u.username.toLowerCase().includes(term)) ||
            (u.name && u.name.toLowerCase().includes(term))
        );
        renderUsers(filtered);
    });
}

// Expose functions globally for onclick handlers
window.viewUserDetail = viewUserDetail;
window.deleteUser = deleteUser;
