import { charts } from './config.js';

export function updateCharts(data) {
    // Destroy existing charts
    Object.values(charts).forEach(chart => chart?.destroy?.());
    Object.keys(charts).forEach(key => delete charts[key]);

    // Daily scan chart
    const dailyCtx = document.getElementById('daily-chart');
    if (dailyCtx && data.daily_stats) {
        const labels = data.daily_stats.map(d => d.date).slice(-7).reverse();
        const values = data.daily_stats.map(d => d.scan_count).slice(-7).reverse();

        charts.daily = new Chart(dailyCtx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Scans',
                    data: values,
                    borderColor: '#FF6B6B',
                    backgroundColor: 'rgba(255, 107, 107, 0.1)',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: 'rgba(255,255,255,0.6)' } },
                    x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.6)' } }
                }
            }
        });
    }

    // Category pie chart
    const categoryCtx = document.getElementById('category-chart');
    if (categoryCtx && data.top_categories) {
        charts.category = new Chart(categoryCtx, {
            type: 'doughnut',
            data: {
                labels: data.top_categories.map(c => c.category),
                datasets: [{
                    data: data.top_categories.map(c => c.count),
                    backgroundColor: ['#FF6B6B', '#FF8E8E', '#4CAF50', '#2196F3', '#FF9800']
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { position: 'bottom', labels: { color: 'rgba(255,255,255,0.6)' } } }
            }
        });
    }

    // Timeline chart (for analytics tab)
    const timelineCtx = document.getElementById('timeline-chart');
    if (timelineCtx && data.daily_stats) {
        const labels = data.daily_stats.map(d => d.date).slice(-14).reverse();
        const values = data.daily_stats.map(d => d.total_calories || d.scan_count).slice(-14).reverse();

        charts.timeline = new Chart(timelineCtx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Calories',
                    data: values,
                    backgroundColor: 'rgba(255, 107, 107, 0.7)',
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: 'rgba(255,255,255,0.6)' } },
                    x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.6)' } }
                }
            }
        });
    }
}
