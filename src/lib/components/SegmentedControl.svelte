<script>
    import { tick, onMount, onDestroy } from 'svelte';

    export let options = [];
    export let value = '';
    export let onchange = () => {};
    export let fullWidth = false;
    export let className = '';
    export let indicatorClass = 'bg-white dark:bg-slate-800 shadow-sm';
    export let ariaLabel = '';

    let container;
    let buttons = [];
    let pill = { left: 0, top: 0, width: 0, height: 0, ready: false };

    function measure() {
        const index = options.findIndex(option => option.value === value);
        const button = buttons[index];
        if (!container || !button) return;
        pill = {
            left: button.offsetLeft,
            top: button.offsetTop,
            width: button.offsetWidth,
            height: button.offsetHeight,
            ready: true
        };
    }

    function select(option) {
        if (option.disabled) return;
        if (option.value === value) return;
        value = option.value;
        onchange(option.value);
    }

    $: if (container && value && options.length) {
        options;
        tick().then(measure);
    }

    let observer;
    onMount(() => {
        observer = new ResizeObserver(() => measure());
        if (container) observer.observe(container);
    });
    onDestroy(() => observer?.disconnect());
</script>

<div bind:this={container}
    class={`relative inline-flex bg-slate-100 dark:bg-slate-700/80 p-1 rounded-lg gap-1 ${fullWidth ? 'w-full' : ''} ${className}`}
    role="tablist" aria-label={ariaLabel || undefined}>
    <div class={`pointer-events-none absolute rounded-md transition-transform duration-300 ease-out ${indicatorClass}`}
        style={`left:0;top:0;width:${pill.width}px;height:${pill.height}px;transform:translate3d(${pill.left}px,${pill.top}px,0);opacity:${pill.ready ? 1 : 0}`}>
    </div>
    {#each options as option, index}
        <button type="button" role="tab" aria-selected={value === option.value}
            disabled={option.disabled}
            bind:this={buttons[index]}
            on:click={() => select(option)}
            class={`relative z-10 flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] rounded-md transition-colors whitespace-nowrap disabled:opacity-50 ${fullWidth ? 'flex-1' : ''} ${value === option.value ? (option.activeClass || 'font-bold text-slate-800 dark:text-white') : 'text-slate-500 dark:text-slate-300 hover:text-slate-700 dark:hover:text-slate-100'}`}>
            {#if option.icon}<i class={`ph ${option.icon}`}></i>{/if}
            <span>{option.label}</span>
            {#if option.badge}<span class="text-[9px] opacity-70">{option.badge}</span>{/if}
        </button>
    {/each}
</div>

<svelte:window on:resize={measure} />
