import { elements, currentToken } from './config.js';

export function showDashboard() {
    elements.loginScreen.style.display = 'none';
    elements.loginScreen.classList.remove('active');
    elements.dashboardScreen.style.display = 'flex';
    elements.dashboardScreen.classList.add('active');
}

export function showLogin() {
    elements.dashboardScreen.style.display = 'none';
    elements.dashboardScreen.classList.remove('active');
    elements.loginScreen.style.display = 'flex';
    elements.loginScreen.classList.add('active');
}

export function initNavigation() {
    elements.navItems.forEach(item => {
        item.addEventListener('click', () => {
            const tabId = item.dataset.tab;

            elements.navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            elements.tabContents.forEach(content => {
                content.classList.remove('active');
                if (content.id === `${tabId}-tab`) {
                    content.classList.add('active');
                }
            });

            const title = 
                tabId === 'overview' ? 'Dashboard Overview' :
                tabId === 'users' ? 'User Management' :
                tabId === 'scans' ? 'Scan History' :
                tabId === 'analytics' ? 'Analytics' :
                tabId === 'user-analytics' ? 'User Analytics' :
                tabId === 'alerts' ? 'Real-time Alerts' :
                tabId === 'mobile' ? 'Mobile Integration' :
                tabId === 'performance' ? 'Performance Monitoring' :
                tabId === 'segments' ? 'User Segmentation' :
                'Dashboard';
            elements.pageTitle.textContent = title;
        });
    });
}
