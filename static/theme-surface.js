(function (root) {
    var colors = { light: '#ffffff', dark: '#0f172a', ocean: '#e0f2fe', forest: '#ecfdf5', sunset: '#fff7ed', rose: '#fff1f2', frosted: '#eef4ff' };
    function applySystemBars(theme) {
        var resolved = Object.prototype.hasOwnProperty.call(colors, theme) ? theme : 'light';
        var meta = root.document && root.document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', colors[resolved]);
        var bridge = root.WorkPlanAndroid;
        if (bridge && typeof bridge.setSystemBars === 'function') {
            try { bridge.setSystemBars(resolved); } catch (_) {}
        }
    }
    root.WorkPlanTheme = Object.freeze({ applySystemBars: applySystemBars });
})(typeof window === 'undefined' ? globalThis : window);
