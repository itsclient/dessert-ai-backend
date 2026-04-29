import { API_BASE_URL, elements, setCurrentToken } from './config.js';
import { showDashboard, showLogin } from './ui.js';
import { loadAllData } from './data.js';

// Login handler
export function initAuth() {
    elements.loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('admin-email').value;
        const password = document.getElementById('admin-password').value;
        const loginBtn = elements.loginForm.querySelector('.login-btn');
        const btnContent = loginBtn.querySelector('.btn-content');
        const btnProgress = loginBtn.querySelector('.btn-progress');

        // Clear previous errors
        elements.loginError.textContent = '';
        elements.loginError.classList.remove('show');

        // Show loading state
        btnContent.style.opacity = '0.7';
        btnProgress.style.left = '0';
        loginBtn.disabled = true;

        try {
            const response = await fetch(`${API_BASE_URL}/api/admin/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (data.success) {
                // Save credentials if remember me is checked
                if (window.saveCredentials) {
                    window.saveCredentials(email, password);
                }

                // Success feedback
                btnContent.innerHTML = '<i class="fas fa-check"></i> <span>Sweet Success!</span>';
                btnContent.style.color = '#4CAF50';
                
                // Brief delay before redirect
                setTimeout(() => {
                    setCurrentToken(data.user);
                    showDashboard();
                    loadAllData();
                }, 500);
            } else {
                // Error feedback
                elements.loginError.textContent = data.error || 'Login failed';
                elements.loginError.classList.add('show');
                
                // Reset button state with error indication
                btnContent.innerHTML = '<i class="fas fa-exclamation-triangle"></i> <span>Try Again</span>';
                btnContent.style.color = '#ff6b6b';
                
                setTimeout(() => {
                    btnContent.innerHTML = '<i class="fas fa-sign-in-alt"></i> <span>Sign In</span>';
                    btnContent.style.color = 'white';
                    btnContent.style.opacity = '1';
                    btnProgress.style.left = '-100%';
                    loginBtn.disabled = false;
                }, 2000);
            }
        } catch (err) {
            // Network error handling
            elements.loginError.textContent = 'Cannot connect to server. Is the backend running?';
            elements.loginError.classList.add('show');
            
            // Reset button state
            btnContent.innerHTML = '<i class="fas fa-wifi"></i> <span>Connection Error</span>';
            btnContent.style.color = '#ff9800';
            
            setTimeout(() => {
                btnContent.innerHTML = '<i class="fas fa-sign-in-alt"></i> <span>Sign In</span>';
                btnContent.style.color = 'white';
                btnContent.style.opacity = '1';
                btnProgress.style.left = '-100%';
                loginBtn.disabled = false;
            }, 2000);
        }
    });

    elements.logoutBtn.addEventListener('click', () => {
        setCurrentToken(null);
        showLogin();
        
        // Clear remembered credentials on logout
        if (window.saveCredentials) {
            window.saveCredentials('', '');
        }
    });
}
