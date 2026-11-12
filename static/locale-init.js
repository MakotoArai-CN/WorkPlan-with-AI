(function (root) {
    var supported = ['zh', 'zh-Hant', 'en', 'ja', 'ko', 'ru'];
    function normalize(value) {
        var language = String(value || '').trim().replace(/_/g, '-').split(/[.@]/)[0].toLowerCase();
        if (!language) return null;
        if (/^zh-(?:hant|tw|hk|mo)(?:-|$)/.test(language)) return 'zh-Hant';
        var short = language.split('-')[0];
        return supported.indexOf(short) >= 0 ? short : null;
    }
    function current() {
        var saved;
        try { saved = normalize(root.localStorage && root.localStorage.getItem('workplan_locale')); } catch (_) {}
        if (saved) return saved;
        var system = root.__WORKPLAN_SYSTEM_LOCALE__;
        // Native Linux supplies the effective POSIX locale, including C/POSIX.
        // Its explicit English fallback must not be overridden by WebKit prefs.
        if (typeof system === 'string' && system.trim()) return normalize(system) || 'en';
        return normalize(root.navigator && root.navigator.language) || 'en';
    }
    root.WorkPlanLocale = Object.freeze({ normalize: normalize, current: current });
    if (root.document) root.document.documentElement.lang = current();
})(typeof window === 'undefined' ? globalThis : window);
