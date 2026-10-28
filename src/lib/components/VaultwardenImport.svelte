<script>
    import { _ } from 'svelte-i18n';
    import { onDestroy } from 'svelte';
    import { importFromVaultwarden, pushToVaultwarden } from '../utils/vaultwarden.js';

    export let disabled = false;
    export let itemCount = 0;
    export let getItems = () => [];
    export let onImported = () => {};
    export let onPushed = () => {};

    let mode = 'import';
    let baseUrl = '';
    let email = '';
    let masterPassword = '';
    let showPassword = false;
    let loading = false;
    let error = '';
    let result = null;
    let pushResult = null;

    $: canSubmit = !disabled && !loading && baseUrl.trim() && email.trim() && masterPassword
        && (mode === 'import' || itemCount > 0);

    function switchMode(next) {
        if (loading || mode === next) return;
        mode = next;
        error = '';
        result = null;
        pushResult = null;
        masterPassword = '';
        showPassword = false;
    }

    async function submit() {
        if (mode === 'push') await doPush();
        else await doImport();
    }

    async function doImport() {
        if (loading || disabled) return;
        if (!baseUrl.trim() || !email.trim() || !masterPassword) {
            error = $_('passwords.vaultwarden_required');
            return;
        }
        loading = true;
        error = '';
        result = null;
        try {
            const imported = await importFromVaultwarden({
                baseUrl,
                email,
                masterPassword
            });
            result = imported;
            if (!imported.items.length) {
                error = $_('passwords.vaultwarden_empty');
                return;
            }
            masterPassword = '';
            onImported(imported.items);
        } catch (e) {
            error = e.message || String(e);
        } finally {
            loading = false;
        }
    }

    async function doPush() {
        if (loading || disabled) return;
        if (!baseUrl.trim() || !email.trim() || !masterPassword) {
            error = $_('passwords.vaultwarden_required');
            return;
        }
        const items = getItems();
        if (!Array.isArray(items) || items.length === 0) {
            error = $_('passwords.vaultwarden_push_empty');
            return;
        }
        loading = true;
        error = '';
        pushResult = null;
        try {
            const pushed = await pushToVaultwarden({
                baseUrl,
                email,
                masterPassword,
                items
            });
            pushResult = pushed;
            masterPassword = '';
            onPushed(pushed);
        } catch (e) {
            error = e.message || String(e);
        } finally {
            loading = false;
        }
    }

    onDestroy(() => {
        masterPassword = '';
    });

    const inputClass = 'w-full border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:border-amber-400 disabled:opacity-50 disabled:cursor-not-allowed';
</script>

<div class="mt-1 rounded-xl border border-amber-200/80 bg-amber-50/50 dark:border-amber-800/60 dark:bg-amber-900/10 p-3.5 md:p-4">
    <div class="flex items-start gap-3">
        <div class="w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
            <i class="ph-fill ph-key text-lg text-amber-700 dark:text-amber-300"></i>
        </div>
        <div class="min-w-0 flex-1">
            <div class="text-sm font-bold text-slate-800 dark:text-slate-100">
                {mode === 'push' ? $_('passwords.vaultwarden_push_title') : $_('passwords.vaultwarden_title')}
            </div>
            <div class="text-[10px] md:text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-4">
                {mode === 'push' ? $_('passwords.vaultwarden_push_desc') : $_('passwords.vaultwarden_desc')}
            </div>
        </div>
        <div class="inline-flex bg-white/70 dark:bg-slate-900/40 border border-amber-100 dark:border-amber-800/60 rounded-lg p-0.5 shrink-0">
            <button type="button" disabled={loading} on:click={() => switchMode('import')}
                class="px-2.5 py-1 rounded-md text-[10px] font-bold {mode === 'import' ? 'bg-amber-600 text-white shadow-sm' : 'text-slate-500 dark:text-slate-300'} disabled:opacity-50">
                {$_('passwords.vaultwarden_mode_import')}
            </button>
            <button type="button" disabled={loading} on:click={() => switchMode('push')}
                class="px-2.5 py-1 rounded-md text-[10px] font-bold {mode === 'push' ? 'bg-amber-600 text-white shadow-sm' : 'text-slate-500 dark:text-slate-300'} disabled:opacity-50">
                {$_('passwords.vaultwarden_mode_push')}
            </button>
        </div>
    </div>

    {#if disabled}
        <div class="mt-3 flex items-start gap-2 rounded-lg bg-white/70 dark:bg-slate-900/30 px-3 py-2 text-[10px] text-amber-700 dark:text-amber-300">
            <i class="ph ph-lock-key mt-0.5"></i>
            <span>{mode === 'push' ? $_('passwords.vaultwarden_push_locked') : $_('passwords.vaultwarden_locked')}</span>
        </div>
    {/if}

    <form class="mt-3 space-y-3" on:submit|preventDefault={submit} autocomplete="off">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div class="md:col-span-2 flex flex-col gap-1">
                <label for="vaultwarden-server" class="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                    {$_('passwords.vaultwarden_server')}
                </label>
                <input id="vaultwarden-server" bind:value={baseUrl} placeholder="https://vault.example.com"
                    disabled={disabled} autocomplete="url" class={inputClass} />
                <div class="flex flex-wrap gap-1.5 mt-0.5">
                    <button type="button" disabled={disabled} on:click={() => baseUrl = 'https://vault.bitwarden.com'}
                        class="px-2 py-1 rounded-md bg-white/80 dark:bg-slate-800 border border-amber-100 dark:border-amber-800 text-[10px] font-bold text-slate-500 dark:text-slate-300 hover:text-amber-700 disabled:opacity-50">
                        {$_('passwords.vaultwarden_bitwarden_com')}
                    </button>
                    <button type="button" disabled={disabled} on:click={() => baseUrl = 'https://vault.bitwarden.eu'}
                        class="px-2 py-1 rounded-md bg-white/80 dark:bg-slate-800 border border-amber-100 dark:border-amber-800 text-[10px] font-bold text-slate-500 dark:text-slate-300 hover:text-amber-700 disabled:opacity-50">
                        {$_('passwords.vaultwarden_bitwarden_eu')}
                    </button>
                </div>
            </div>

            <div class="flex flex-col gap-1">
                <label for="vaultwarden-email" class="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                    {$_('passwords.vaultwarden_email')}
                </label>
                <input id="vaultwarden-email" bind:value={email} type="email" autocomplete="username"
                    disabled={disabled} class={inputClass} />
            </div>

            <div class="flex flex-col gap-1">
                <label for="vaultwarden-password" class="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                    {$_('passwords.vaultwarden_master')}
                </label>
                <div class="relative">
                    <input id="vaultwarden-password" bind:value={masterPassword}
                        type={showPassword ? 'text' : 'password'} autocomplete="current-password"
                        disabled={disabled} class={`${inputClass} pr-10`} />
                    <button type="button" on:click={() => (showPassword = !showPassword)}
                        class="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        aria-label={$_('passwords.show_password')}>
                        <i class={`ph ${showPassword ? 'ph-eye-slash' : 'ph-eye'}`}></i>
                    </button>
                </div>
            </div>
        </div>

        <div class="text-[10px] text-slate-500 dark:text-slate-400 leading-5">
            {mode === 'push' ? $_('passwords.vaultwarden_push_hint') : $_('passwords.vaultwarden_hint')}
        </div>

        {#if error}
            <div class="text-[11px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2 break-words">{error}</div>
        {/if}
        {#if mode === 'import' && result && result.items.length}
            <div class="text-[11px] text-green-700 dark:text-green-400 flex items-center gap-1.5">
                <i class="ph-fill ph-check-circle"></i>
                {$_('passwords.vaultwarden_success', { values: { count: result.items.length } })}
            </div>
        {/if}
        {#if mode === 'push' && pushResult}
            <div class="text-[11px] text-green-700 dark:text-green-400 flex items-center gap-1.5">
                <i class="ph-fill ph-check-circle"></i>
                {$_('passwords.vaultwarden_push_success', { values: { pushed: pushResult.pushed, skipped: pushResult.skipped, failed: pushResult.failed } })}
            </div>
            {#if pushResult.errors?.length}
                <div class="text-[10px] text-amber-700 dark:text-amber-300 bg-amber-100/60 dark:bg-amber-900/20 rounded-lg px-3 py-2 space-y-0.5">
                    {#each pushResult.errors as message}
                        <div>{message}</div>
                    {/each}
                </div>
            {/if}
        {/if}

        <div class="flex items-center justify-between gap-2">
            <div class="text-[10px] text-slate-500 dark:text-slate-400">
                {#if mode === 'push'}
                    {$_('passwords.vaultwarden_push_count', { values: { count: itemCount } })}
                {/if}
            </div>
            <button type="submit" disabled={!canSubmit}
                class="w-full sm:w-auto px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-2">
                {#if loading}
                    <i class="ph ph-spinner animate-spin"></i>
                    {mode === 'push' ? $_('passwords.vaultwarden_pushing') : $_('passwords.vaultwarden_importing')}
                {:else}
                    <i class={`ph ${mode === 'push' ? 'ph-upload-simple' : 'ph-download-simple'}`}></i>
                    {mode === 'push' ? $_('passwords.vaultwarden_push_button') : $_('passwords.vaultwarden_import')}
                {/if}
            </button>
        </div>
    </form>
</div>
