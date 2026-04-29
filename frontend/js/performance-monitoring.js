import { API_BASE_URL } from './config.js';
import { showNotification } from './notifications.js';

let performanceInterval = null;

export function initPerformanceMonitoring() {
    loadPerformance();
    // Refresh performance every 10 seconds
    performanceInterval = setInterval(loadPerformance, 10000);
}

export function loadPerformance() {
    fetch(`${API_BASE_URL}/api/admin/performance`)
        .then(response => response.json())
        .then(data => {
            renderPerformance(data);
        })
        .catch(err => {
            console.error('Error loading performance:', err);
        });
}

export function refreshPerformance() {
    loadPerformance();
    showNotification('Performance data refreshed', 'info');
}

function renderPerformance(data) {
    document.getElementById('uptime').textContent = formatUptime(data.uptime);
    document.getElementById('memory-usage').textContent = `${data.memory.used}MB / ${data.memory.total}MB`;
    document.getElementById('node-version').textContent = data.node_version;
    document.getElementById('response-time').textContent = '45ms'; // Simulated response time
}

function formatUptime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${secs}s`;
    } else {
        return `${secs}s`;
    }
}
