// Test dashboard directly - bypass login
console.log('🧪 Testing dashboard display...');

// Get elements
const loginScreen = document.getElementById('login-screen');
const dashboardScreen = document.getElementById('dashboard-screen');

console.log('🎯 Elements found:');
console.log('   loginScreen:', loginScreen);
console.log('   dashboardScreen:', dashboardScreen);

// Test direct dashboard show
function testShowDashboard() {
    console.log('🎯 Testing showDashboard...');
    
    if (loginScreen) {
        loginScreen.style.display = 'none';
        loginScreen.classList.remove('active');
        console.log('✅ Login screen hidden');
    } else {
        console.log('❌ Login screen not found');
    }
    
    if (dashboardScreen) {
        dashboardScreen.style.display = 'flex';
        dashboardScreen.classList.add('active');
        console.log('✅ Dashboard screen shown');
    } else {
        console.log('❌ Dashboard screen not found');
    }
}

// Test after DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', testShowDashboard);
} else {
    testShowDashboard();
}
