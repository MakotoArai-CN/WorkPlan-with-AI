<script>
    import { onMount, createEventDispatcher } from 'svelte';
    import { _ } from 'svelte-i18n';
    import { sidebarPanelLayout, detailWidthFromKey } from '../utils/panel-resize.js';

    export let storageKey;
    export let controls;
    export let defaultWidth = 288;
    export let minWidth = 200;
    export let maxWidth = 480;
    export let reserveWidth = 360;
    export let collapsed = false;
    export let collapsedWidth = null;

    const dispatch = createEventDispatcher();
    let handle;
    let panel;
    let desktop = false;
    let availableWidth = 0;
    let preferredWidth = defaultWidth;
    let dragWidth = null;
    let pointerId = null;
    let originX = 0;
    let originWidth = 0;
    let originalWidth = '';
    let restoreSelection = null;

    $: options = { defaultWidth, minWidth, maxWidth, reserveWidth };
    $: layout = sidebarPanelLayout(availableWidth, preferredWidth, options);
    $: width = dragWidth ?? (collapsed && collapsedWidth !== null ? Math.min(collapsedWidth, availableWidth) : layout.width);
    $: if (panel) panel.style.width = desktop ? `${width}px` : originalWidth;

    onMount(() => {
        panel = handle.parentElement;
        originalWidth = panel.style.width;
        try {
            const saved = Number(localStorage.getItem(storageKey));
            if (Number.isFinite(saved) && saved > 0) preferredWidth = saved;
        } catch {}
        const media = window.matchMedia('(min-width: 768px)');
        const measure = () => { availableWidth = panel.parentElement.getBoundingClientRect().width; };
        const updateViewport = () => {
            desktop = media.matches;
            if (!desktop) finish();
            measure();
        };
        updateViewport();
        const observer = new ResizeObserver(measure);
        observer.observe(panel.parentElement);
        media.addEventListener('change', updateViewport);
        return () => {
            finish();
            observer.disconnect();
            media.removeEventListener('change', updateViewport);
            panel.style.width = originalWidth;
        };
    });

    function save() {
        try { localStorage.setItem(storageKey, String(Math.round(preferredWidth))); } catch {}
    }

    function start(event) {
        if (event.button !== 0 || !desktop || pointerId !== null) return;
        event.preventDefault();
        try { handle.setPointerCapture(event.pointerId); } catch { return; }
        pointerId = event.pointerId;
        originX = event.clientX;
        originWidth = width;
        dragWidth = width;
        panel.classList.add('sidebar-resizing');
        const root = panel.ownerDocument.documentElement;
        const previous = { cursor: root.style.cursor, userSelect: root.style.userSelect };
        root.style.cursor = 'col-resize';
        root.style.userSelect = 'none';
        restoreSelection = () => Object.assign(root.style, previous);
    }

    function move(event) {
        if (event.pointerId !== pointerId) return;
        const minimum = collapsedWidth === null ? layout.min : Math.min(collapsedWidth, layout.min);
        dragWidth = Math.round(Math.max(minimum, Math.min(layout.max, originWidth + event.clientX - originX)));
        if (collapsedWidth !== null) collapsed = dragWidth < layout.min;
    }

    function finish(event) {
        if (pointerId === null || event && event.pointerId !== pointerId) return;
        const activePointer = pointerId;
        pointerId = null;
        if (dragWidth !== null && (!collapsed || collapsedWidth === null)) preferredWidth = dragWidth;
        dragWidth = null;
        panel?.classList.remove('sidebar-resizing');
        restoreSelection?.();
        restoreSelection = null;
        if (handle?.hasPointerCapture(activePointer)) handle.releasePointerCapture(activePointer);
        save();
        dispatch('resize');
    }

    function keydown(event) {
        const next = detailWidthFromKey(event.key, width, collapsedWidth === null ? layout.min : Math.min(collapsedWidth, layout.min), layout.max, 'right');
        if (next === null || !desktop) return;
        event.preventDefault();
        if (collapsedWidth !== null) {
            collapsed = event.key === 'Home' || next < layout.min && event.key !== 'ArrowRight';
        }
        if (!collapsed || collapsedWidth === null) preferredWidth = Math.max(layout.min, next);
        save();
        dispatch('resize');
    }

    function reset() {
        collapsed = false;
        preferredWidth = defaultWidth;
        save();
        dispatch('resize');
    }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex a11y_no_noninteractive_element_interactions -->
<div bind:this={handle} class="sidebar-resize-handle" role="separator" tabindex={desktop ? 0 : -1}
    aria-label={$_('common.resize_panel')} title={$_('common.resize_panel')}
    aria-orientation="vertical" aria-controls={controls}
    aria-valuenow={width} aria-valuemin={collapsedWidth === null ? layout.min : Math.min(collapsedWidth, layout.min)} aria-valuemax={layout.max}
    on:pointerdown={start} on:pointermove={move} on:pointerup={finish} on:pointercancel={finish}
    on:lostpointercapture={finish} on:keydown={keydown} on:dblclick={reset}><span></span></div>

<style>
    .sidebar-resize-handle {
        display: none;
        position: absolute;
        inset: 0 0 0 auto;
        width: 9px;
        z-index: 20;
        cursor: col-resize;
        touch-action: none;
        outline: none;
    }
    @media (min-width: 768px) { .sidebar-resize-handle { display: block; } }
    .sidebar-resize-handle span {
        position: absolute;
        right: 1px;
        top: 50%;
        height: 36px;
        width: 3px;
        border-radius: 3px;
        transform: translateY(-50%);
        background: var(--app-border-strong, #cbd5e1);
        transition: background 120ms ease;
    }
    .sidebar-resize-handle:hover span,
    .sidebar-resize-handle:focus-visible span,
    :global(.sidebar-resizing) .sidebar-resize-handle span { background: #60a5fa; }
    :global(.sidebar-resizing) { transition: none !important; }
    @media (prefers-reduced-motion: reduce) { .sidebar-resize-handle span { transition: none; } }
</style>
