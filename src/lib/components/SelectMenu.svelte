<script>
    import { tick } from 'svelte';

    export let options = [];
    export let value = '';
    export let onchange = () => {};
    export let placeholder = '请选择';
    export let disabled = false;
    export let className = '';
    export let buttonClass = 'w-full border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200 flex items-center justify-between gap-2';
    export let ariaLabel = '';

    let trigger;
    let menu;
    let open = false;
    let menuStyle = '';

    $: selected = options.find(option => option.value === value);

    function portal(node) {
        document.body.appendChild(node);
        return {
            destroy() {
                node.remove();
            }
        };
    }

    function reducedMotion() {
        return document.documentElement.classList.contains('reduce-animations')
            || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    }

    async function toggle() {
        if (disabled) return;
        if (open) {
            close();
            return;
        }
        open = true;
        await tick();
        positionMenu();
    }

    function positionMenu() {
        if (!trigger || !menu) return;
        const rect = trigger.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        const gap = 6;
        let top = rect.bottom + gap;
        if (top + menuRect.height > window.innerHeight - 8) {
            top = Math.max(8, rect.top - menuRect.height - gap);
        }
        let left = rect.left;
        if (left + menuRect.width > window.innerWidth - 8) {
            left = Math.max(8, window.innerWidth - menuRect.width - 8);
        }
        menuStyle = `left:${left}px;top:${top}px;min-width:${Math.max(rect.width, 160)}px;`;
    }

    function close() {
        open = false;
    }

    function choose(option) {
        if (option.disabled) return;
        value = option.value;
        onchange(option.value);
        close();
    }

    function outside(event) {
        if (!open) return;
        if (trigger?.contains(event.target) || menu?.contains(event.target)) return;
        close();
    }

    function key(event) {
        if (event.key === 'Escape' && open) {
            event.preventDefault();
            close();
        }
    }

    $: if (open && menu) {
        tick().then(() => {
            positionMenu();
            if (!reducedMotion()) {
                menu.animate([
                    { opacity: 0, transform: 'translateY(-4px) scale(0.97)' },
                    { opacity: 1, transform: 'translateY(0) scale(1)' }
                ], { duration: 160, easing: 'cubic-bezier(0.22, 0.8, 0.24, 1)' });
            }
        });
    }
</script>

<svelte:window on:click={outside} on:keydown={key} on:resize={close} on:scroll={close} />

<button bind:this={trigger} type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open}
    aria-label={ariaLabel || undefined} on:click={toggle} class={`${buttonClass} ${className}`}>
    <span class={`truncate text-left ${selected ? '' : 'text-slate-400'}`}>
        {#if selected?.icon}<i class={`ph ${selected.icon} mr-1`}></i>{/if}
        {selected?.label ?? placeholder}
    </span>
    <i class={`ph ph-caret-down text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}></i>
</button>

{#if open}
    <div use:portal bind:this={menu} style={menuStyle}
        class="fixed z-[300] max-h-64 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-2xl p-1"
        role="listbox">
        {#each options as option}
            <button type="button" role="option" aria-selected={option.value === value}
                disabled={option.disabled}
                on:click={() => choose(option)}
                class={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-xs transition-colors disabled:opacity-40 ${option.value === value ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-200 font-bold' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
                {#if option.icon}<i class={`ph ${option.icon}`}></i>{/if}
                <span class="flex-1 min-w-0">
                    <span class="block truncate">{option.label}</span>
                    {#if option.description}<span class="block text-[10px] font-normal text-slate-400 truncate">{option.description}</span>{/if}
                </span>
                {#if option.value === value}<i class="ph-bold ph-check text-xs"></i>{/if}
            </button>
        {/each}
    </div>
{/if}
