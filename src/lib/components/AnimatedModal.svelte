<script>
    import { tick, onDestroy } from 'svelte';

    export let show = false;
    export let onClose = () => {};
    export let zIndex = 60;
    export let panelClass = 'max-w-lg';
    export let panelStyle = '';
    export let closeOnBackdrop = true;
    export let dismissible = true;
    export let ariaLabel = '';

    let panel;
    let content;
    let backdrop;
    let wasShown = false;
    let rendered = false;
    let closing = false;
    let animationToken = 0;
    let animations = [];
    let originRect = null;

    function reducedMotion() {
        if (typeof window === 'undefined') return true;
        return document.documentElement.classList.contains('reduce-animations')
            || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    }

    function cancelAnimations() {
        for (const animation of animations) {
            try { animation.cancel(); } catch {}
        }
        animations = [];
    }

    function animate(node, keyframes, options) {
        if (!node || reducedMotion()) return null;
        const animation = node.animate(keyframes, options);
        animations.push(animation);
        return animation;
    }

    function triggerRect() {
        const active = document.activeElement;
        if (active && active !== document.body && active !== document.documentElement) {
            const rect = active.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) return rect;
        }
        return null;
    }

    async function open() {
        const token = ++animationToken;
        await tick();
        if (token !== animationToken) return;
        if (!panel || !show || !rendered) return;
        cancelAnimations();
        closing = false;
        const target = panel.getBoundingClientRect();
        originRect = triggerRect();
        const origin = originRect;
        const reduced = reducedMotion();

        if (reduced) {
            panel.style.opacity = '1';
            if (backdrop) backdrop.style.opacity = '1';
            if (content) content.style.opacity = '1';
            return;
        }

        panel.style.opacity = '0';
        if (backdrop) backdrop.style.opacity = '0';
        if (content) content.style.opacity = '0';

        const duration = 420;
        const dx = origin ? origin.left + origin.width / 2 - (target.left + target.width / 2) : 0;
        const dy = origin ? origin.top + origin.height / 2 - (target.top + target.height / 2) : 0;
        const sx = origin ? Math.max(0.18, Math.min(1, origin.width / Math.max(target.width, 1))) : 0.92;
        const sy = origin ? Math.max(0.18, Math.min(1, origin.height / Math.max(target.height, 1))) : 0.92;

        animate(backdrop, [
            { opacity: 0 },
            { opacity: 1 }
        ], { duration: 260, easing: 'ease-out', fill: 'both' });

        animate(panel, [
            { opacity: 0, transform: `translate3d(${dx}px, ${dy}px, 0) scale(${sx}, ${sy})` },
            { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1, 1)' }
        ], { duration, easing: 'cubic-bezier(0.22, 0.8, 0.24, 1)', fill: 'both' });

        animate(content, [
            { opacity: 0.15, filter: 'blur(10px)' },
            { opacity: 0.15, filter: 'blur(10px)', offset: 0.5 },
            { opacity: 1, filter: 'blur(0px)' }
        ], { duration, easing: 'ease-out', fill: 'both' });
    }

    async function close(notify = true) {
        if (closing || !rendered) return;
        if (!panel || reducedMotion()) {
            rendered = false;
            wasShown = false;
            closing = false;
            if (notify) onClose();
            return;
        }
        closing = true;
        const token = ++animationToken;
        cancelAnimations();
        const target = panel.getBoundingClientRect();
        const origin = originRect || triggerRect();
        const dx = origin ? origin.left + origin.width / 2 - (target.left + target.width / 2) : 0;
        const dy = origin ? origin.top + origin.height / 2 - (target.top + target.height / 2) : 0;
        const sx = origin ? Math.max(0.18, Math.min(1, origin.width / Math.max(target.width, 1))) : 0.92;
        const sy = origin ? Math.max(0.18, Math.min(1, origin.height / Math.max(target.height, 1))) : 0.92;

        animate(panel, [
            { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1, 1)' },
            { opacity: 0, transform: `translate3d(${dx}px, ${dy}px, 0) scale(${sx}, ${sy})` }
        ], { duration: 300, easing: 'cubic-bezier(0.4, 0, 0.8, 0.2)', fill: 'both' });
        animate(backdrop, [{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'ease-in', fill: 'both' });
        animate(content, [
            { opacity: 1, filter: 'blur(0px)' },
            { opacity: 0, filter: 'blur(6px)' }
        ], { duration: 260, easing: 'ease-in', fill: 'both' });

        await new Promise(resolve => setTimeout(resolve, 310));
        if (token !== animationToken) return;
        closing = false;

        if (notify) {
            wasShown = false;
            rendered = false;
            onClose();
            return;
        }

        if (show) {
            wasShown = false;
            open();
            return;
        }

        wasShown = false;
        rendered = false;
    }

    function handleBackdrop() {
        if (closeOnBackdrop) close();
    }

    function handleKey(event) {
        if (event.key === 'Escape' && show && dismissible) {
            event.preventDefault();
            close();
        }
    }

    $: if (show && !wasShown) {
        wasShown = true;
        rendered = true;
        closing = false;
        open();
    }
    $: if (!show && wasShown) {
        wasShown = false;
        close(false);
    }

    onDestroy(cancelAnimations);
</script>

<svelte:window on:keydown={handleKey} />

{#if rendered}
    <div class="fixed inset-0 flex items-center justify-center p-4" style={`z-index:${zIndex}`} role="dialog" aria-modal="true" aria-label={ariaLabel || undefined}>
        <div bind:this={backdrop}
            class="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            role={dismissible ? 'button' : 'presentation'} tabindex="-1" aria-label={dismissible ? 'Close' : undefined}
            on:click={() => dismissible && handleBackdrop()}
            on:keydown={(event) => dismissible && event.key === 'Enter' && handleBackdrop()}></div>
        <div bind:this={panel}
            class={`relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full ${panelClass} max-h-[92vh] flex flex-col overflow-hidden`}
            style={`opacity:0; transform-origin:center center; ${panelStyle}`}>
            <div bind:this={content} class="flex flex-col min-h-0 flex-1 overflow-hidden">
                <slot />
            </div>
        </div>
    </div>
{/if}
