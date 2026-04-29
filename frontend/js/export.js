import { usersData, scansData } from './config.js';
import { showNotification } from './notifications.js';

export function exportToCSV(filename, data, headers) {
    let csv = headers.join(',') + '\n';
    
    data.forEach(row => {
        const values = headers.map(header => {
            let value = row[header] || '';
            // Escape quotes and wrap in quotes if contains comma
            if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                value = `"${value.replace(/"/g, '""')}"`;
            }
            return value;
        });
        csv += values.join(',') + '\n';
    });

    downloadFile(filename, csv, 'text/csv');
}

export function exportUsers() {
    const headers = ['id', 'email', 'username', 'name', 'role', 'created_at'];
    const data = usersData.map(user => ({
        ...user,
        created_at: user.created_at ? new Date(user.created_at).toLocaleString() : ''
    }));
    
    exportToCSV('users_export.csv', data, headers);
    showNotification('Users exported successfully', 'success');
}

export function exportScans() {
    const headers = ['id', 'user_email', 'dessert_name', 'category', 'calories', 'protein_grams', 'carbs_grams', 'fat_grams', 'is_favorite', 'scanned_at'];
    const data = scansData.map(scan => ({
        ...scan,
        scanned_at: scan.scanned_at ? new Date(scan.scanned_at).toLocaleString() : '',
        is_favorite: scan.is_favorite ? 1 : 0
    }));
    
    exportToCSV('scans_export.csv', data, headers);
    showNotification('Scans exported successfully', 'success');
}

export function exportAllData() {
    exportUsers();
    setTimeout(() => exportScans(), 500);
}

function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}
