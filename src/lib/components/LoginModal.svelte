<script>
    import { taskStore } from '../stores/tasks.js';
    import { showAlert } from '../stores/modal.js';
    import { _ } from 'svelte-i18n';
    import { get } from 'svelte/store';

    let inputKey = '';
    let validationError = '';
    let isSubmitting = false;
    let loginSuccess = false;

    const KEYBOARD_PATTERNS = [
        'qwertyuiop', 'asdfghjkl', 'zxcvbnm',
        'qwerty', 'asdfgh', 'zxcvbn',
        '1234567890', '0987654321',
        'qazwsx', 'wsxedc', 'edcrfv',
        'poiuytrewq', 'lkjhgfdsa', 'mnbvcxz'
    ];

    function hasConsecutiveChars(str, minLength = 4) {
        const lower = str.toLowerCase();
        for (let i = 0; i <= lower.length - minLength; i++) {
            const segment = lower.slice(i, i + minLength);
            let isConsecutive = true;
            for (let j = 1; j < segment.length; j++) {
                if (segment.charCodeAt(j) - segment.charCodeAt(j - 1) !== 1) {
                    isConsecutive = false;
                    break;
                }
            }
            if (isConsecutive) return true;
        }
        return false;
    }

    function hasRepeatingChars(str, minLength = 4) {
        const lower = str.toLowerCase();
        for (let i = 0; i <= lower.length - minLength; i++) {
            const char = lower[i];
            let count = 1;
            for (let j = i + 1; j < lower.length && lower[j] === char; j++) {
                count++;
            }
            if (count >= minLength) return true;
        }
        return false;
    }

    function containsKeyboardPattern(str) {
        const lower = str.toLowerCase();
        for (const pattern of KEYBOARD_PATTERNS) {
            if (lower.includes(pattern.slice(0, 5))) return true;
            const reversed = pattern.split('').reverse().join('');
            if (lower.includes(reversed.slice(0, 5))) return true;
        }
        return false;
    }

    function isSystemGenerated(key) {
        const pattern = /^user_[a-z0-9]{9}$/;
        if (pattern.test(key)) return true;

        const extendedPattern = /^user_[a-zA-Z0-9_]+_[a-z0-9]{9}$/;
        if (extendedPattern.test(key)) {
            const suffix = key.slice(-9);
            return /^[a-z0-9]{9}$/.test(suffix);
        }

        return false;
    }

    function validateKey(key) {
        const t = get(_);
        if (!key || !key.trim()) {
            return t('login_page.error_empty');
        }

        const trimmed = key.trim();

        if (isSystemGenerated(trimmed)) {
            return '';
        }

        if (trimmed.length < 16) {
            return t('login_page.error_short', { values: { count: trimmed.length } });
        }

        if (trimmed.length > 64) {
            return t('login_page.error_long', { values: { count: trimmed.length } });
        }

        if (hasConsecutiveChars(trimmed)) {
            return t('login_page.error_seq');
        }

        if (hasRepeatingChars(trimmed)) {
            return t('login_page.error_rep');
        }

        if (containsKeyboardPattern(trimmed)) {
            return t('login_page.error_kbd');
        }

        return '';
    }

    function prefersReducedMotion() {
        if (typeof document === 'undefined') return false;
        return document.documentElement.classList.contains('reduce-animations')
            || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    }

    async function login() {
        if (isSubmitting) return;
        const t = get(_);
        const error = validateKey(inputKey);
        if (error) {
            validationError = error;
            await showAlert({ title: t('login_page.error_title'), message: error, variant: 'warning' });
            return;
        }
        validationError = '';
        isSubmitting = true;
        const reduced = prefersReducedMotion();
        if (!reduced) await new Promise((resolve) => setTimeout(resolve, 380));
        loginSuccess = true;
        if (!reduced) await new Promise((resolve) => setTimeout(resolve, 320));
        taskStore.login(inputKey.trim());
    }

    function generateKey() {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let suffix = '';
        for (let i = 0; i < 9; i++) {
            suffix += chars[Math.floor(Math.random() * chars.length)];
        }
        inputKey = 'user_' + suffix;
        validationError = '';
    }

    function handleInput() {
        if (inputKey.trim()) {
            validationError = validateKey(inputKey);
        } else {
            validationError = '';
        }
    }
</script>
<div class="login-shell fixed inset-0 z-[80] flex items-center justify-center overflow-hidden bg-[#050914] p-4 safe-area-login">
    <div class="login-aurora login-aurora-a"></div>
    <div class="login-aurora login-aurora-b"></div>
    <div class="login-aurora login-aurora-c"></div>
    <div class="login-grid"></div>
    <div class="login-vignette"></div>

    <div class="relative z-10 w-full max-w-[420px]">
        <div class="login-card relative overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/70 p-7 sm:p-8 shadow-[0_30px_120px_-20px_rgba(37,99,235,0.55)] backdrop-blur-2xl">
            <div class="login-sheen"></div>

            <div class="text-center mb-7">
                <div class="login-logo relative w-[72px] h-[72px] mx-auto mb-5">
                    <div class="absolute inset-0 rounded-[22px] bg-gradient-to-br from-cyan-400 via-blue-500 to-violet-500 blur-xl opacity-70"></div>
                    <div class="relative w-full h-full rounded-[22px] bg-gradient-to-br from-cyan-400 via-blue-500 to-violet-500 flex items-center justify-center text-white text-3xl shadow-lg shadow-blue-500/30 ring-1 ring-white/20">
                        <i class="ph-bold ph-check-square-offset"></i>
                    </div>
                </div>
                <h1 class="text-[26px] font-black tracking-tight text-white">
                    WorkPlan <span class="login-gradient-text">Cloud</span>
                </h1>
                <p class="text-sm text-slate-400 mt-2">{$_('login_page.subtitle')}</p>
            </div>

            <div class="space-y-4">
                <div class="login-field">
                    <label for="login-access-key" class="text-[10px] font-bold text-slate-400 uppercase tracking-[0.18em] ml-1">Access Key</label>
                    <div class="relative mt-2">
                        <input id="login-access-key" type="text" bind:value={inputKey}
                            on:input={handleInput}
                            on:keyup={(e) => e.key === 'Enter' && login()}
                            placeholder={$_('login_page.placeholder')}
                            autocomplete="off" spellcheck="false"
                            class={`w-full rounded-xl border-2 bg-white/[0.04] px-4 py-3.5 pr-11 text-center font-mono text-base font-bold text-white placeholder:text-slate-500 focus:outline-none focus:ring-4 transition-all duration-200 ${validationError
                                ? 'border-rose-400/70 focus:border-rose-400 focus:ring-rose-500/15 text-rose-100'
                                : 'border-white/10 focus:border-blue-400 focus:ring-blue-500/15'}`}>
                        <div class="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500">
                            <i class="ph ph-key text-lg"></i>
                        </div>
                    </div>
                    {#if validationError}
                        <div class="text-xs text-rose-300 mt-2 px-1 flex items-start gap-1.5" aria-live="polite">
                            <i class="ph ph-warning-circle shrink-0 mt-0.5"></i>
                            <span>{validationError}</span>
                        </div>
                    {/if}
                    <div class="text-[10px] text-slate-500 mt-2 px-1 leading-relaxed">
                        {$_('login_page.hint')}
                    </div>
                </div>

                <button on:click={login}
                    class={`login-field group relative w-full overflow-hidden rounded-xl py-3.5 text-[15px] font-bold text-white shadow-lg transition-all duration-300 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-60 ${loginSuccess
                        ? 'bg-emerald-500 shadow-emerald-500/25'
                        : 'bg-gradient-to-r from-blue-600 via-indigo-500 to-violet-500 shadow-blue-500/25'}`}
                    disabled={isSubmitting || (!!validationError && inputKey.trim().length > 0)}>
                    <span class="login-btn-shine"></span>
                    <span class="relative flex items-center justify-center gap-2">
                        {#if loginSuccess}
                            <i class="ph-bold ph-check-circle text-lg"></i> {$_('login_page.entering')}
                        {:else if isSubmitting}
                            <span class="login-spinner"></span> {$_('login_page.verifying')}
                        {:else}
                            <i class="ph-bold ph-arrow-right text-lg"></i> {$_('login_page.enter_btn')}
                        {/if}
                    </span>
                </button>

                <div class="login-field text-center">
                    <button on:click={generateKey}
                        class="mx-auto flex items-center justify-center gap-1.5 py-2 text-xs font-bold text-slate-400 transition-colors hover:text-cyan-300">
                        <i class="ph-bold ph-magic-wand"></i> {$_('login_page.generate_key')}
                    </button>
                </div>
            </div>

        </div>
    </div>
</div>

<style>
    .safe-area-login {
        padding-top: max(1rem, env(safe-area-inset-top));
        padding-bottom: max(1rem, env(safe-area-inset-bottom));
    }

    .login-aurora {
        position: absolute;
        width: 58vw;
        height: 58vw;
        min-width: 420px;
        min-height: 420px;
        border-radius: 9999px;
        filter: blur(90px);
        opacity: 0.5;
        pointer-events: none;
        animation: login-aurora-drift 16s ease-in-out infinite alternate;
    }
    .login-aurora-a {
        top: -24%;
        left: -12%;
        background: radial-gradient(circle, rgba(37, 99, 235, 0.8), transparent 65%);
    }
    .login-aurora-b {
        right: -16%;
        bottom: -28%;
        background: radial-gradient(circle, rgba(124, 58, 237, 0.75), transparent 65%);
        animation-delay: -5s;
    }
    .login-aurora-c {
        top: 28%;
        left: 52%;
        width: 36vw;
        height: 36vw;
        background: radial-gradient(circle, rgba(6, 182, 212, 0.55), transparent 65%);
        animation-delay: -9s;
    }

    .login-grid {
        position: absolute;
        inset: 0;
        background-image:
            linear-gradient(rgba(148, 163, 184, 0.07) 1px, transparent 1px),
            linear-gradient(90deg, rgba(148, 163, 184, 0.07) 1px, transparent 1px);
        background-size: 52px 52px;
        mask-image: radial-gradient(circle at 50% 45%, black 0%, transparent 72%);
        -webkit-mask-image: radial-gradient(circle at 50% 45%, black 0%, transparent 72%);
        pointer-events: none;
    }
    .login-vignette {
        position: absolute;
        inset: 0;
        background: radial-gradient(circle at 50% 42%, transparent 0%, rgba(5, 9, 20, 0.55) 58%, #050914 100%);
        pointer-events: none;
    }

    .login-card {
        animation: login-card-in 0.9s cubic-bezier(0.16, 1, 0.3, 1) both;
    }
    .login-sheen {
        position: absolute;
        inset: 0;
        border-radius: inherit;
        background: linear-gradient(135deg, rgba(255,255,255,0.11), transparent 36%, transparent 68%, rgba(255,255,255,0.04));
        pointer-events: none;
    }
    .login-logo {
        animation: login-logo-in 1.1s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both;
    }
    .login-field {
        animation: login-field-in 0.7s cubic-bezier(0.16, 1, 0.3, 1) both;
    }
    .login-field:nth-child(1) { animation-delay: 0.2s; }
    .login-field:nth-child(2) { animation-delay: 0.3s; }
    .login-field:nth-child(3) { animation-delay: 0.4s; }

    .login-gradient-text {
        background: linear-gradient(100deg, #67e8f9 0%, #60a5fa 45%, #c4b5fd 100%);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
    }
    .login-btn-shine {
        position: absolute;
        inset: 0;
        background: linear-gradient(110deg, transparent 28%, rgba(255,255,255,0.34) 46%, transparent 64%);
        transform: translateX(-130%);
        animation: login-shine 4.2s ease-in-out infinite;
    }
    .login-spinner {
        width: 16px;
        height: 16px;
        border-radius: 9999px;
        border: 2px solid rgba(255,255,255,0.35);
        border-top-color: white;
        animation: login-spin 0.7s linear infinite;
    }

    @keyframes login-card-in {
        from { opacity: 0; transform: translateY(32px) scale(0.94); filter: blur(14px); }
        to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
    }
    @keyframes login-logo-in {
        from { opacity: 0; transform: scale(0.55) rotate(-8deg); filter: blur(10px); }
        to { opacity: 1; transform: scale(1) rotate(0); filter: blur(0); }
    }
    @keyframes login-field-in {
        from { opacity: 0; transform: translateY(14px); filter: blur(6px); }
        to { opacity: 1; transform: translateY(0); filter: blur(0); }
    }
    @keyframes login-aurora-drift {
        0% { transform: translate3d(0, 0, 0) scale(1); }
        50% { transform: translate3d(6%, -4%, 0) scale(1.12); }
        100% { transform: translate3d(-5%, 5%, 0) scale(0.96); }
    }
    @keyframes login-shine {
        0%, 55% { transform: translateX(-130%); }
        75%, 100% { transform: translateX(130%); }
    }
    @keyframes login-spin {
        to { transform: rotate(360deg); }
    }
</style>
