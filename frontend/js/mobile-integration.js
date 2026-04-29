import { API_BASE_URL } from './config.js';
import { showNotification } from './notifications.js';

export function loadMobileStats() {
    fetch(`${API_BASE_URL}/api/admin/mobile/stats`)
        .then(response => response.json())
        .then(data => {
            renderMobileStats(data);
        })
        .catch(err => {
            console.error('Error loading mobile stats:', err);
        });
}

function renderMobileStats(stats) {
    document.getElementById('app-version').textContent = stats.app_version;
    document.getElementById('total-devices').textContent = stats.total_devices;
    document.getElementById('active-devices').textContent = stats.active_devices;
    document.getElementById('push-sent').textContent = stats.push_notifications_sent;
}

window.sendPushNotification = function() {
    const message = prompt('Enter push notification message:');
    if (!message) return;

    // This would normally send to a push notification service
    showNotification('Push notification sent to all users', 'success');
};

window.trackDevice = function() {
    showNotification('Device tracking enabled', 'info');
};
