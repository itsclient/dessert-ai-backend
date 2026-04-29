import { scansData } from './config.js';
import { addCheckboxToScanRow } from './bulk-actions.js';

export function renderScans(scans) {
    const tbody = document.getElementById('scans-table-body');
    tbody.innerHTML = '';

    if (!scans || scans.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px;">No scans found</td></tr>';
        return;
    }

    scans.forEach(scan => {
        const row = document.createElement('tr');
        const date = scan.scanned_at ? new Date(scan.scanned_at).toLocaleDateString() : 'N/A';
        const username = scan.username || scan.name || scan.user_email;

        row.innerHTML = `
            <td>${scan.id}</td>
            <td>${username}</td>
            <td><strong>${scan.dessert_name}</strong></td>
            <td><span class="category-badge">${scan.category || 'Unknown'}</span></td>
            <td>${scan.calories || 0}</td>
            <td>${scan.protein_grams || 0}g</td>
            <td>${date}</td>
            <td>${scan.is_favorite ? '<span class="favorite-badge"><i class="fas fa-heart"></i></span>' : '-'}</td>
        `;
        
        addCheckboxToScanRow(row, scan);
        tbody.appendChild(row);
    });
}

// Search functionality
export function initScanSearch() {
    document.getElementById('scan-search')?.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = scansData.filter(s => 
            s.dessert_name.toLowerCase().includes(term) ||
            s.user_email.toLowerCase().includes(term) ||
            (s.category && s.category.toLowerCase().includes(term))
        );
        renderScans(filtered);
    });
}
