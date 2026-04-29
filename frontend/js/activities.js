import { API_BASE_URL } from './config.js';

let activitiesData = [];

export function renderActivities(activities) {
    activitiesData = activities || [];
    const tbody = document.getElementById('activities-table-body');
    tbody.innerHTML = '';

    if (activitiesData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 40px;">No activities yet</td></tr>';
        return;
    }

    activitiesData.forEach(activity => {
        const row = document.createElement('tr');
        const date = activity.created_at ? new Date(activity.created_at).toLocaleString() : 'N/A';
        const username = activity.username || activity.name || activity.user_email;

        const typeIcon = {
            'register': 'fa-user-plus',
            'login': 'fa-sign-in-alt',
            'sync': 'fa-sync',
            'scan': 'fa-camera',
            'profile_update': 'fa-user-edit',
            'password_change': 'fa-key',
        }[activity.activity_type] || 'fa-circle';

        const typeBadge = {
            'register': 'badge-register',
            'login': 'badge-login',
            'sync': 'badge-sync',
            'scan': 'badge-scan',
            'profile_update': 'badge-profile',
            'password_change': 'badge-password',
        }[activity.activity_type] || 'badge-default';

        row.innerHTML = `
            <td>${activity.id}</td>
            <td><strong>${username}</strong></td>
            <td><span class="activity-badge ${typeBadge}"><i class="fas ${typeIcon}"></i> ${activity.activity_type}</span></td>
            <td>${activity.description || '-'}</td>
            <td>${date}</td>
        `;
        tbody.appendChild(row);
    });
}

export async function loadActivities() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/activities`);
        const data = await response.json();
        renderActivities(data.activities || []);
    } catch (err) {
        console.error('Error loading activities:', err);
    }
}

export function initActivitySearch() {
    document.getElementById('activity-search')?.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = activitiesData.filter(a => 
            (a.user_email && a.user_email.toLowerCase().includes(term)) ||
            (a.username && a.username.toLowerCase().includes(term)) ||
            (a.activity_type && a.activity_type.toLowerCase().includes(term)) ||
            (a.description && a.description.toLowerCase().includes(term))
        );
        renderActivities(filtered);
    });
}
