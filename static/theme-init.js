(function () {
    try {
        var saved = localStorage.getItem('planpro_system_settings');
        var mode = 'auto';
        if (saved) {
            try {
                mode = JSON.parse(saved).theme || 'auto';
            } catch (e) {}
        }
        var isDark = mode === 'dark'
            || (mode === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        if (isDark) {
            document.documentElement.classList.add('dark');
            document.documentElement.style.colorScheme = 'dark';
            var themeColor = document.querySelector('meta[name="theme-color"]');
            if (themeColor) themeColor.setAttribute('content', '#0f172a');
        }
    } catch (e) {}
})();
