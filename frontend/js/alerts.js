import { API_BASE_URL } from './config.js';
import { showNotification } from './notifications.js';

let alertInterval = null;

export function initAlerts() {
    loadAlerts();
    // Refresh alerts every 30 seconds
    alertInterval = setInterval(loadAlerts, 30000);
}

export function loadAlerts() {
    fetch(`${API_BASE_URL}/api/admin/alerts`)
        .then(response => response.json())
        .then(alerts => {
            renderAlerts(alerts);
        })
        .catch(err => {
            console.error('Error loading alerts:', err);
        });
}

export function refreshAlerts() {
    loadAlerts();
    showNotification('Alerts refreshed', 'info');
}

function renderAlerts(alerts) {
    const container = document.getElementById('alerts-container');
    if (!container) return;

    if (alerts.length === 0) {
        container.innerHTML = '<div class="no-alerts">No alerts at this time</div>';
        return;
    }

    container.innerHTML = alerts.map(alert => `
        <div class="alert-item alert-${alert.level}">
            <div class="alert-icon">
                <i class="fas ${getAlertIcon(alert.type)}"></i>
            </div>
            <div class="alert-content">
                <div class="alert-message">${alert.message}</div>
                <div class="alert-time">Just now</div>
            </div>
            <div class="alert-actions">
                <button class="btn-small" onclick="dismissAlert('${alert.type}')">
                    <i class="fas fa-check"></i>
                </button>
            </div>
        </div>
    `).join('');
}

function getAlertIcon(type) {
    const icons = {
        'new_users': 'fa-user-plus',
        'high_calories': 'fa-exclamation-triangle',
        'memory': 'fa-memory',
        'system': 'fa-server'
    };
    return icons[type] || 'fa-info-circle';
}

window.dismissAlert = function(type) {
    showNotification(`Alert dismissed: ${type}`, 'success');
    loadAlerts();
};
