export function initThemeToggle() {
    const themeToggle = document.getElementById('theme-toggle-btn');
    if (!themeToggle) return;
    
    // Load saved theme
    const savedTheme = localStorage.getItem('nutrivision-theme') || 'light';
    setTheme(savedTheme);
    
    // Toggle theme on click
    themeToggle.addEventListener('click', toggleTheme);
}

function toggleTheme() {
    const currentTheme = document.body.classList.contains('dark-theme') ? 'dark' : 'light';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
}

function setTheme(theme) {
    const body = document.body;
    const themeToggle = document.querySelector('.theme-toggle i');
    
    if (theme === 'dark') {
        body.classList.add('dark-theme');
        body.classList.remove('light-theme');
        if (themeToggle) themeToggle.className = 'fas fa-sun';
    } else {
        body.classList.add('light-theme');
        body.classList.remove('dark-theme');
        if (themeToggle) themeToggle.className = 'fas fa-moon';
    }
    
    localStorage.setItem('nutrivision-theme', theme);
}
