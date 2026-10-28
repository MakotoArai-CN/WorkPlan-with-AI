<script>
    import { onMount, onDestroy } from 'svelte';
    import { _ } from 'svelte-i18n';

    export let onDone = () => {};

    let leaving = false;
    let timers = [];

    function reducedMotion() {
        if (typeof document === 'undefined') return false;
        return document.documentElement.classList.contains('reduce-animations')
            || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    }

    onMount(() => {
        const reduced = reducedMotion();
        if (reduced) {
            onDone();
            return;
        }
        timers.push(setTimeout(() => (leaving = true), 820));
        timers.push(setTimeout(() => onDone(), 1640));
    });

    onDestroy(() => timers.forEach(clearTimeout));
</script>

<div class="login-transition fixed inset-0 z-[90] overflow-hidden" class:leaving aria-live="polite" aria-label={$_('login_page.entering')}>
    <div class="transition-bg absolute inset-0"></div>
    <div class="transition-orb transition-orb-a"></div>
    <div class="transition-orb transition-orb-b"></div>
    <div class="transition-grid absolute inset-0"></div>

    <div class="transition-stage relative z-10 flex h-full flex-col items-center justify-center px-6">
        <div class="transition-logo relative mb-6 h-20 w-20">
            <div class="absolute inset-0 rounded-[24px] bg-gradient-to-br from-cyan-400 via-blue-500 to-violet-500 blur-2xl opacity-80"></div>
            <div class="relative flex h-full w-full items-center justify-center rounded-[24px] bg-gradient-to-br from-cyan-400 via-blue-500 to-violet-500 text-4xl text-white ring-1 ring-white/20">
                <i class="ph-bold ph-check-square-offset"></i>
            </div>
        </div>
        <div class="transition-word text-3xl font-black tracking-tight text-white">
            WorkPlan <span class="transition-gradient-text">Cloud</span>
        </div>
        <div class="mt-3 flex items-center gap-2 text-xs font-medium tracking-[0.2em] text-slate-400 uppercase">
            <span class="transition-dot"></span>
            {$_('login_page.entering')}
        </div>
        <div class="transition-progress mt-8 h-[3px] w-48 overflow-hidden rounded-full bg-white/10">
            <div class="transition-progress-bar h-full rounded-full bg-gradient-to-r from-cyan-400 via-blue-400 to-violet-400"></div>
        </div>
    </div>

    <div class="transition-streak absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/60 to-transparent"></div>
</div>

<style>
    .login-transition {
        background: #050914;
        transform: translate3d(0, 0, 0);
        transition: transform 0.72s cubic-bezier(0.76, 0, 0.24, 1), border-radius 0.72s cubic-bezier(0.76, 0, 0.24, 1);
        will-change: transform;
        border-radius: 0;
    }
    .login-transition.leaving {
        transform: translate3d(0, -100%, 0);
        border-radius: 0 0 42px 42px;
        pointer-events: none;
    }
    .login-transition.leaving .transition-stage {
        opacity: 0;
        transform: translateY(-14px) scale(0.98);
        transition: opacity 0.35s ease, transform 0.35s ease;
    }

    .transition-bg {
        background:
            radial-gradient(circle at 50% 42%, rgba(37, 99, 235, 0.24), transparent 42%),
            radial-gradient(circle at 18% 82%, rgba(124, 58, 237, 0.2), transparent 40%),
            #050914;
    }
    .transition-orb {
        position: absolute;
        width: 46vw;
        height: 46vw;
        min-width: 320px;
        min-height: 320px;
        border-radius: 9999px;
        filter: blur(100px);
        opacity: 0.45;
        animation: transition-drift 9s ease-in-out infinite alternate;
    }
    .transition-orb-a {
        top: -22%;
        left: -12%;
        background: #2563eb;
    }
    .transition-orb-b {
        right: -14%;
        bottom: -26%;
        background: #7c3aed;
        animation-delay: -4s;
    }
    .transition-grid {
        background-image:
            linear-gradient(rgba(148, 163, 184, 0.06) 1px, transparent 1px),
            linear-gradient(90deg, rgba(148, 163, 184, 0.06) 1px, transparent 1px);
        background-size: 54px 54px;
        mask-image: radial-gradient(circle at 50% 46%, black, transparent 72%);
        -webkit-mask-image: radial-gradient(circle at 50% 46%, black, transparent 72%);
    }

    .transition-stage {
        animation: transition-stage-in 0.55s cubic-bezier(0.16, 1, 0.3, 1) both;
    }
    .transition-logo {
        animation: transition-logo-in 0.7s cubic-bezier(0.16, 1, 0.3, 1) both;
    }
    .transition-word {
        animation: transition-word-in 0.65s cubic-bezier(0.16, 1, 0.3, 1) 0.08s both;
    }
    .transition-gradient-text {
        background: linear-gradient(100deg, #67e8f9, #60a5fa, #c4b5fd);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
    }
    .transition-dot {
        width: 6px;
        height: 6px;
        border-radius: 9999px;
        background: #22d3ee;
        box-shadow: 0 0 12px #22d3ee;
        animation: transition-pulse 1.2s ease-in-out infinite;
    }
    .transition-progress-bar {
        width: 0%;
        animation: transition-progress 0.92s cubic-bezier(0.22, 1, 0.36, 1) both;
    }
    .transition-streak {
        animation: transition-streak 1.1s ease-out both;
    }

    @keyframes transition-stage-in {
        from { opacity: 0; transform: scale(0.96); filter: blur(8px); }
        to { opacity: 1; transform: scale(1); filter: blur(0); }
    }
    @keyframes transition-logo-in {
        from { opacity: 0; transform: scale(0.5) rotate(-6deg); }
        to { opacity: 1; transform: scale(1) rotate(0); }
    }
    @keyframes transition-word-in {
        from { opacity: 0; transform: translateY(10px); filter: blur(8px); }
        to { opacity: 1; transform: translateY(0); filter: blur(0); }
    }
    @keyframes transition-progress {
        from { width: 0%; }
        to { width: 100%; }
    }
    @keyframes transition-pulse {
        0%, 100% { opacity: 0.45; transform: scale(0.8); }
        50% { opacity: 1; transform: scale(1.15); }
    }
    @keyframes transition-drift {
        from { transform: translate3d(0, 0, 0) scale(1); }
        to { transform: translate3d(5%, -4%, 0) scale(1.14); }
    }
    @keyframes transition-streak {
        from { opacity: 0; transform: translateX(-30%); }
        40% { opacity: 1; }
        to { opacity: 0; transform: translateX(30%); }
    }
</style>
