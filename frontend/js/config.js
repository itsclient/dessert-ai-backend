// Global configuration and state
export const API_BASE_URL = window.location.origin;

export let currentToken = null;
export let usersData = [];
export let scansData = [];
export let charts = {};

export function setCurrentToken(token) {
    currentToken = token;
    if (token) {
        sessionStorage.setItem('adminToken', JSON.stringify(token));
    } else {
        sessionStorage.removeItem('adminToken');
    }
}

// Check for existing token on page load
export function checkExistingToken() {
    const savedToken = sessionStorage.getItem('adminToken');
    if (savedToken) {
        try {
            currentToken = JSON.parse(savedToken);
            return currentToken;
        } catch (e) {
            sessionStorage.removeItem('adminToken');
        }
    }
    return null;
}

// DOM Elements - use getters to ensure DOM is ready when accessed
export const elements = {
    get loginScreen() { return document.getElementById('login-screen'); },
    get dashboardScreen() { return document.getElementById('dashboard-screen'); },
    get loginForm() { return document.getElementById('login-form'); },
    get loginError() { return document.getElementById('login-error'); },
    get navItems() { return document.querySelectorAll('.nav-item'); },
    get tabContents() { return document.querySelectorAll('.tab-content'); },
    get logoutBtn() { return document.getElementById('logout-btn'); },
    get pageTitle() { return document.getElementById('page-title'); }
};
