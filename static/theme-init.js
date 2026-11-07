(function () {
    try {
        var ua = navigator.userAgent || '';
        if (/Linux/i.test(ua) && !/Android/i.test(ua)) {
            document.documentElement.dataset.platform = 'linux';
        }
        var saved = localStorage.getItem('planpro_system_settings');
        var mode = 'auto';
        if (saved) {
            try {
                mode = JSON.parse(saved).theme || 'auto';
            } catch (e) {}
        }
        // graphite was retired in favour of the liquid glass theme.
        if (mode === 'graphite' || mode === 'liquidglass') mode = 'frosted';
        var isDark = mode === 'dark'
            || (mode === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        var resolved = mode === 'auto' ? (isDark ? 'dark' : 'light') : mode;
        document.documentElement.dataset.theme = resolved;
        if (isDark) {
            document.documentElement.classList.add('dark');
            document.documentElement.style.colorScheme = 'dark';
            var themeColor = document.querySelector('meta[name="theme-color"]');
            if (themeColor) themeColor.setAttribute('content', mode === 'frosted' ? '#eef4ff' : '#0f172a');
        }
    } catch (e) {}
})();
