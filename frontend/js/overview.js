export function updateOverview(data) {
    document.getElementById('total-users').textContent = data.total_users || 0;
    document.getElementById('total-scans').textContent = data.total_scans || 0;
    document.getElementById('avg-calories').textContent = data.avg_calories || 0;

    const today = new Date().toISOString().split('T')[0];
    const scansToday = data.daily_stats?.filter(d => d.date === today)[0]?.scan_count || 0;
    document.getElementById('scans-today').textContent = scansToday;
}
