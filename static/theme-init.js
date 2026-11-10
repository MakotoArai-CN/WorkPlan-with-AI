(function () {
    try {
        var ua = navigator.userAgent || '';
        if (/Linux/i.test(ua) && !/Android/i.test(ua)) {
            document.documentElement.dataset.platform = 'linux';
        }
        // One-time key rename: older builds used the planpro_ prefix.
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var oldKey = localStorage.key(i);
                if (!oldKey || oldKey.indexOf('planpro_') !== 0) continue;
                var newKey = 'workplan_' + oldKey.slice('planpro_'.length);
                if (localStorage.getItem(newKey) === null) {
                    localStorage.setItem(newKey, localStorage.getItem(oldKey));
                }
            }
        } catch (e) {}

        var saved = localStorage.getItem('workplan_system_settings');
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
