import { API_BASE_URL } from './config.js';
import { showNotification } from './notifications.js';

export function loadUserAnalytics() {
    fetch(`${API_BASE_URL}/api/admin/analytics/users`)
        .then(response => response.json())
        .then(data => {
            renderUserGrowth(data.growth);
            renderLeaderboard(data.leaderboard);
            renderRetention(data.retention);
            renderAvgScans(data.avgScans);
        })
        .catch(err => {
            console.error('Error loading user analytics:', err);
            showNotification('Error loading user analytics', 'error');
        });
}

function renderUserGrowth(growth) {
    const ctx = document.getElementById('user-growth-chart');
    if (!ctx) return;

    new Chart(ctx, {
        type: 'line',
        data: {
            labels: growth.map(item => item.date),
            datasets: [{
                label: 'New Users',
                data: growth.map(item => item.new_users),
                borderColor: 'rgb(75, 192, 192)',
                backgroundColor: 'rgba(75, 192, 192, 0.2)',
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

function renderLeaderboard(leaderboard) {
    const container = document.getElementById('user-leaderboard');
    if (!container) return;

    container.innerHTML = leaderboard.map((user, index) => `
        <div class="leaderboard-item">
            <span class="rank">#${index + 1}</span>
            <div class="user-info">
                <strong>${user.username || user.email}</strong>
                <small>${user.scan_count} scans</small>
            </div>
        </div>
    `).join('');
}

function renderRetention(retention) {
    const container = document.getElementById('user-retention-stats');
    if (!container) return;

    container.innerHTML = `
        <div class="retention-stats">
            <div class="stat">
                <span class="label">New Users (7 days)</span>
                <span class="value">${retention[0]?.new_users || 0}</span>
            </div>
            <div class="stat">
                <span class="label">Monthly Users</span>
                <span class="value">${retention[0]?.monthly_users || 0}</span>
            </div>
            <div class="stat">
                <span class="label">Total Users</span>
                <span class="value">${retention[0]?.total_users || 0}</span>
            </div>
        </div>
    `;
}

function renderAvgScans(avgScans) {
    const container = document.getElementById('avg-scans-stats');
    if (!container) return;

    const avg = avgScans[0]?.avg_scans || 0;
    container.innerHTML = `
        <div class="avg-scans-display">
            <div class="big-number">${Math.round(avg)}</div>
            <div class="label">Average Scans Per User</div>
        </div>
    `;
}
