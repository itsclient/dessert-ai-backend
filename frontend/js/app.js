// Main entry point for Admin Dashboard
import { initAuth } from './auth.js';
import { initNavigation, showLogin, showDashboard } from './ui.js';
import { loadAllData } from './data.js';
import { initUserSearch } from './users.js';
import { initScanSearch } from './scans.js';
import { initAdvancedFilters } from './filters.js';
import { initBulkActions } from './bulk-actions.js';
import { initThemeToggle } from './theme-toggle.js';
import { exportUsers, exportScans, exportAllData } from './export.js';
import { loadUserAnalytics } from './user-analytics.js';
import { initAlerts } from './alerts.js';
import { loadMobileStats } from './mobile-integration.js';
import { initPerformanceMonitoring } from './performance-monitoring.js';
import { loadUserSegments } from './user-segmentation.js';
import { checkExistingToken } from './config.js';
import { refreshAlerts } from './alerts.js';
import { refreshPerformance } from './performance-monitoring.js';

// Initialize all modules
document.addEventListener('DOMContentLoaded', () => {
    initAuth();
    initNavigation();
    initUserSearch();
    initScanSearch();
    initAdvancedFilters();
    initBulkActions();
    initThemeToggle();
    initAlerts();
    initPerformanceMonitoring();
    
    // Expose functions globally for onclick handlers
    window.nutrivision = {
        exportUsers,
        exportScans,
        exportAllData,
        loadUserAnalytics,
        loadMobileStats,
        loadUserSegments
    };
    
    // Expose individual functions for onclick handlers
    window.refreshAlerts = refreshAlerts;
    window.refreshPerformance = refreshPerformance;
    
    // Setup tab switching for new tabs
    setupTabSwitching();
    
    // Check for existing login token
    const existingToken = checkExistingToken();
    if (existingToken) {
        showDashboard();
        loadAllData();
    } else {
        showLogin();
    }
});

function setupTabSwitching() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const tabId = item.dataset.tab;
            
            // Load data based on tab
            switch(tabId) {
                case 'user-analytics':
                    loadUserAnalytics();
                    break;
                case 'mobile':
                    loadMobileStats();
                    break;
                case 'segments':
                    loadUserSegments();
                    break;
            }
        });
    });
}
