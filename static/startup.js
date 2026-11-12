(function () {
    var root = document.documentElement;
    root.dataset.startupPlatform = /Android/i.test(navigator.userAgent || '') ? 'android' : 'desktop';

    var copy = {
        en: ['Preparing your workspace', 'Taking a little longer than usual', 'Reload', 'Unable to start. Please try again.'],
        zh: ['\u6b63\u5728\u51c6\u5907\u4f60\u7684\u5de5\u4f5c\u7a7a\u95f4', '\u542f\u52a8\u8017\u65f6\u8f83\u957f\uff0c\u8bf7\u7a0d\u5019', '\u91cd\u65b0\u52a0\u8f7d', '\u542f\u52a8\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5'],
        ja: ['\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9\u3092\u6e96\u5099\u4e2d', '\u901a\u5e38\u3088\u308a\u6642\u9593\u304c\u304b\u304b\u3063\u3066\u3044\u307e\u3059', '\u518d\u8aad\u307f\u8fbc\u307f', '\u8d77\u52d5\u3067\u304d\u307e\u305b\u3093\u3002\u3082\u3046\u4e00\u5ea6\u304a\u8a66\u3057\u304f\u3060\u3055\u3044\u3002'],
        ko: ['\uc791\uc5c5 \uacf5\uac04 \uc900\ube44 \uc911', '\ud3c9\uc18c\ubcf4\ub2e4 \uc2dc\uac04\uc774 \ub354 \uac78\ub9ac\uace0 \uc788\uc2b5\ub2c8\ub2e4', '\uc0c8\ub85c\uace0\uce68', '\uc2dc\uc791\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4. \ub2e4\uc2dc \uc2dc\ub3c4\ud574 \uc8fc\uc138\uc694.'],
        ru: ['\u041f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u043a\u0430 \u0440\u0430\u0431\u043e\u0447\u0435\u0433\u043e \u043f\u0440\u043e\u0441\u0442\u0440\u0430\u043d\u0441\u0442\u0432\u0430', '\u042d\u0442\u043e \u0437\u0430\u043d\u0438\u043c\u0430\u0435\u0442 \u0431\u043e\u043b\u044c\u0448\u0435 \u0432\u0440\u0435\u043c\u0435\u043d\u0438, \u0447\u0435\u043c \u043e\u0431\u044b\u0447\u043d\u043e', '\u041f\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c', '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c. \u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u0435 \u043f\u043e\u043f\u044b\u0442\u043a\u0443.']
    };
    var language = window.WorkPlanLocale ? window.WorkPlanLocale.current() : navigator.language || 'en';
    var reduce = false;
    try {
        if (!window.WorkPlanLocale) language = localStorage.getItem('workplan_locale') || language;
        reduce = JSON.parse(localStorage.getItem('workplan_system_settings') || '{}').reduceAnimations === true;
    } catch (error) {}
    var labels = copy[language.toLowerCase().split('-')[0]] || copy.en;
    if (reduce) root.dataset.startupReduced = 'true';

    var finished = false;
    var initialized = false;
    var slow = false;
    var failed = false;
    var slowTimer = setTimeout(function () { slow = true; updateStatus(); }, 12000);

    function updateStatus() {
        var label = document.getElementById('workplan-startup-status');
        var retry = document.getElementById('workplan-startup-retry');
        var screen = document.getElementById('workplan-startup');
        if (!screen) return;
        if (label) label.textContent = labels[failed ? 3 : slow ? 1 : 0];
        if (retry) {
            retry.textContent = labels[2];
            retry.hidden = !(slow || failed);
        }
        screen.classList.toggle('startup-failed', failed);
    }

    function dismiss() {
        var screen = document.getElementById('workplan-startup');
        if (!screen) return;
        clearTimeout(slowTimer);
        // No minimum display time: reveal the app as soon as it has painted.
        requestAnimationFrame(function () {
            screen.classList.add('startup-leaving');
            screen.setAttribute('aria-hidden', 'true');
            var reduced = reduce || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            setTimeout(function () { screen.remove(); }, reduced ? 0 : 220);
        });
    }

    window.addEventListener('workplan:ready', function () {
        if (finished) return;
        finished = true;
        if (initialized) dismiss();
    });
    window.addEventListener('workplan:startup-error', function () {
        if (finished) return;
        failed = true;
        clearTimeout(slowTimer);
        updateStatus();
    });
    document.addEventListener('DOMContentLoaded', function () {
        initialized = true;
        updateStatus();
        var retry = document.getElementById('workplan-startup-retry');
        if (retry) retry.addEventListener('click', function () { location.reload(); });
        if (finished) dismiss();
    }, { once: true });
})();
