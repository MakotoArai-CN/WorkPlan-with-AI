<script>
    import { passwordsStore } from '../stores/passwords.js';
    import { _ } from 'svelte-i18n';
    import { get } from 'svelte/store';
    import { showConfirm } from '../stores/modal.js';
    import SelectMenu from './SelectMenu.svelte';

    let enabled = passwordsStore.getProtection().enabled;
    let action = passwordsStore.getProtection().action;
    let master = '';
    let busy = false;
    let error = '';
    let saved = false;

    $: actions = [
        { value: 'cooldown', label: $_('passwords.protection_action_cooldown') },
        { value: 'disable_quick_unlock', label: $_('passwords.protection_action_quick') }
    ];

    async function save() {
        if (busy || !master || !$passwordsStore.isUnlocked) return;
        busy = true;
        error = '';
        saved = false;
        try {
            if (enabled && !await showConfirm({
                title: get(_)('passwords.protection_title'),
                message: get(_)('passwords.protection_warning'),
                confirmText: get(_)('common.confirm'), variant: 'warning'
            })) return;
            const result = await passwordsStore.setProtection(enabled, master, action);
            if (!result.success) { error = result.error; return; }
            master = '';
            saved = true;
        } catch (failure) {
            error = failure.message;
        } finally { busy = false; }
    }
</script>

<section class="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
    <div class="p-4 md:p-6 border-b border-slate-100 dark:border-slate-700 font-bold flex items-center gap-2">
        <i class="ph ph-shield-check text-lg text-blue-600"></i>
        {$_('passwords.protection_title')}
    </div>
    <div class="p-4 md:p-6 space-y-4 text-sm">
        <p class="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{$_('passwords.protection_warning')}</p>
        <label class="flex items-center justify-between gap-4">
            <span>{$_('passwords.protection_enable')}</span>
            <input type="checkbox" bind:checked={enabled} disabled={busy} class="accent-blue-600 h-4 w-4" />
        </label>
        {#if enabled}
            <SelectMenu options={actions} bind:value={action} disabled={busy} />
        {/if}
        {#if !$passwordsStore.isUnlocked}
            <p class="text-xs text-amber-600">{$_('passwords.protection_locked_hint')}</p>
        {:else}
            <div class="flex flex-col sm:flex-row gap-2">
                <input type="password" bind:value={master} autocomplete="current-password" disabled={busy}
                    aria-label={$_('passwords.old_password_label')} placeholder={$_('passwords.old_password_placeholder')}
                    on:keydown={event => event.key === 'Enter' && save()}
                    class="min-w-0 flex-1 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 bg-transparent" />
                <button on:click={save} disabled={busy || !master}
                    class="px-4 py-2 rounded-xl bg-blue-600 text-white disabled:opacity-50">{busy ? $_('common.loading') : $_('common.save')}</button>
            </div>
        {/if}
        {#if error}<p role="alert" class="text-xs text-red-600">{error}</p>{/if}
        {#if saved}<p role="status" class="text-xs text-emerald-600">{$_('passwords.protection_saved')}</p>{/if}
    </div>
</section>
