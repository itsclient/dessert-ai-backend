import { API_BASE_URL } from './config.js';
import { showNotification } from './notifications.js';

export function loadUserSegments() {
    fetch(`${API_BASE_URL}/api/admin/segments`)
        .then(response => response.json())
        .then(data => {
            renderSegments(data);
        })
        .catch(err => {
            console.error('Error loading user segments:', err);
        });
}

function renderSegments(segments) {
    renderActiveUsers(segments.active);
    renderInactiveUsers(segments.inactive);
}

function renderActiveUsers(users) {
    const container = document.getElementById('active-users-list');
    if (!container) return;

    if (users.length === 0) {
        container.innerHTML = '<p class="no-users">No active users yet</p>';
        return;
    }

    container.innerHTML = users.map(user => `
        <div class="segment-user">
            <div class="user-avatar">
                <i class="fas fa-user-check"></i>
            </div>
            <div class="user-details">
                <strong>${user.username || user.email}</strong>
                <small>${user.scan_count} scans</small>
            </div>
        </div>
    `).join('');
}

function renderInactiveUsers(users) {
    const container = document.getElementById('inactive-users-list');
    if (!container) return;

    if (users.length === 0) {
        container.innerHTML = '<p class="no-users">No inactive users</p>';
        return;
    }

    container.innerHTML = users.map(user => `
        <div class="segment-user">
            <div class="user-avatar">
                <i class="fas fa-user-times"></i>
            </div>
            <div class="user-details">
                <strong>${user.username || user.email}</strong>
                <small>Last scan: ${user.last_scan ? new Date(user.last_scan).toLocaleDateString() : 'Never'}</small>
            </div>
        </div>
    `).join('');
}

window.sendSegmentNotification = function(segment) {
    showNotification(`Notification sent to ${segment} users`, 'success');
};

window.exportSegment = function(segment) {
    showNotification(`Exporting ${segment} users...`, 'info');
};
