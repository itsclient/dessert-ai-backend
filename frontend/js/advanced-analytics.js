import { API_BASE_URL } from './config.js';
import { showNotification } from './notifications.js';

export function loadAdvancedAnalytics() {
    fetch(`${API_BASE_URL}/api/admin/analytics/advanced`)
        .then(response => response.json())
        .then(data => {
            renderTrends(data.trends);
            renderCorrelations(data.correlations);
            renderSeasonal(data.seasonal);
        })
        .catch(err => {
            console.error('Error loading advanced analytics:', err);
        });
}

function renderTrends(trends) {
    const ctx = document.getElementById('trends-chart');
    if (!ctx) return;

    new Chart(ctx, {
        type: 'line',
        data: {
            labels: trends.map(item => new Date(item.date).toLocaleDateString()),
            datasets: [{
                label: 'Scans per Day',
                data: trends.map(item => item.scans),
                borderColor: 'rgb(54, 162, 235)',
                backgroundColor: 'rgba(54, 162, 235, 0.2)',
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

function renderCorrelations(correlations) {
    const ctx = document.getElementById('correlations-chart');
    if (!ctx) return;

    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: correlations.map(item => item.category),
            datasets: [{
                label: 'Average Calories',
                data: correlations.map(item => Math.round(item.avg_calories)),
                backgroundColor: [
                    'rgba(255, 99, 132, 0.6)',
                    'rgba(54, 162, 235, 0.6)',
                    'rgba(255, 206, 86, 0.6)',
                    'rgba(75, 192, 192, 0.6)',
                    'rgba(153, 102, 255, 0.6)'
                ]
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

function renderSeasonal(seasonal) {
    const ctx = document.getElementById('seasonal-chart');
    if (!ctx) return;

    // Fill missing hours with 0
    const hourlyData = Array.from({length: 24}, (_, i) => {
        const hourData = seasonal.find(item => parseInt(item.hour) === i);
        return hourData ? hourData.count : 0;
    });

    new Chart(ctx, {
        type: 'radar',
        data: {
            labels: Array.from({length: 24}, (_, i) => `${i}:00`),
            datasets: [{
                label: 'Activity by Hour',
                data: hourlyData,
                borderColor: 'rgb(75, 192, 192)',
                backgroundColor: 'rgba(75, 192, 192, 0.2)',
                pointBackgroundColor: 'rgb(75, 192, 192)',
                pointBorderColor: '#fff',
                pointHoverBackgroundColor: '#fff',
                pointHoverBorderColor: 'rgb(75, 192, 192)'
            }]
        },
        options: {
            responsive: true,
            scales: {
                r: {
                    beginAtZero: true
                }
            }
        }
    });
}
