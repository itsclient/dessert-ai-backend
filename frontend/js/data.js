import { API_BASE_URL, usersData, scansData, charts } from './config.js';
import { updateOverview } from './overview.js';
import { renderUsers } from './users.js';
import { renderScans } from './scans.js';
import { updateCharts } from './analytics.js';

export async function loadAllData() {
    try {
        // Load stats
        const statsResponse = await fetch(`${API_BASE_URL}/api/admin/stats`);
        const statsData = await statsResponse.json();
        updateOverview(statsData);

        // Load users
        const usersResponse = await fetch(`${API_BASE_URL}/api/admin/users`);
        const usersResult = await usersResponse.json();
        usersData.length = 0;
        usersData.push(...(usersResult.users || []));
        renderUsers(usersData);

        // Load scans
        const scansResponse = await fetch(`${API_BASE_URL}/api/admin/scans`);
        const scansResult = await scansResponse.json();
        scansData.length = 0;
        scansData.push(...(scansResult.scans || []));
        renderScans(scansData);

        // Update charts
        updateCharts(statsData);
    } catch (err) {
        console.error('Error loading data:', err);
    }
}
