<script>
    import { passwordsStore } from '../stores/passwords.js';
    import { _ } from 'svelte-i18n';
    import { get } from 'svelte/store';
    import { showAlert, showToast } from '../stores/modal.js';
    import SelectMenu from './SelectMenu.svelte';
    import AnimatedModal from './AnimatedModal.svelte';

    let enabled = passwordsStore.getProtection().enabled;
    let action = passwordsStore.getProtection().action;
    let master = '';
    let busy = false;
    let error = '';
    let showDialog = false;
    let pendingEnabled = enabled;
    let pendingAction = action;

    $: actions = [
        { value: 'cooldown', label: $_('passwords.protection_action_cooldown') },
        { value: 'disable_quick_unlock', label: $_('passwords.protection_action_quick') }
    ];

    async function openDialog(nextEnabled) {
        if (busy || showDialog) return;
        if (!$passwordsStore.isUnlocked) {
            await showAlert({ message: get(_)('passwords.protection_locked_hint'), variant: 'warning' });
            return;
        }
        pendingEnabled = nextEnabled;
        pendingAction = passwordsStore.getProtection().action;
        master = '';
        error = '';
        showDialog = true;
    }

    function closeDialog() {
        if (busy) return;
        showDialog = false;
        master = '';
        error = '';
    }

    async function save() {
        if (busy || !master || !$passwordsStore.isUnlocked) return;
        busy = true;
        error = '';
        try {
            const result = await passwordsStore.setProtection(pendingEnabled, master, pendingAction);
            if (!result.success) { error = result.error; return; }
            const committed = passwordsStore.getProtection();
            enabled = committed.enabled;
            action = committed.action;
            master = '';
            showDialog = false;
            showToast({ message: get(_)('passwords.protection_saved'), type: 'success' });
        } catch (failure) {
            error = failure.message;
        } finally { busy = false; }
    }
</script>

<section class="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
    <div class="p-4 md:p-6 flex items-center justify-between gap-4">
        <div class="min-w-0">
            <h3 id="vault-protection-title" class="font-bold text-slate-700 dark:text-slate-200 text-sm md:text-base flex items-center gap-2">
                <i class="ph ph-shield-check text-blue-600" aria-hidden="true"></i>{$_('passwords.protection_title')}
            </h3>
            <p class="mt-1 text-[10px] md:text-xs text-slate-500 dark:text-slate-400">{$_('passwords.protection_brief')}</p>
        </div>
        <button type="button" role="switch" aria-checked={enabled} aria-labelledby="vault-protection-title"
            on:click={() => openDialog(!enabled)} disabled={busy}
            class="relative shrink-0 w-11 h-6 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-500 disabled:opacity-50"
            class:bg-blue-600={enabled} class:bg-gray-200={!enabled} class:dark:bg-gray-600={!enabled}>
            <span class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform" class:translate-x-5={enabled}></span>
        </button>
    </div>
    {#if enabled}
        <div class="px-4 md:px-6 pb-4 flex items-center justify-between gap-3 text-xs">
            <span class="min-w-0 text-slate-500 dark:text-slate-400">{$_(action === 'disable_quick_unlock' ? 'passwords.protection_action_quick' : 'passwords.protection_action_cooldown')}</span>
            <button on:click={() => openDialog(true)} disabled={busy} class="shrink-0 text-blue-600 font-bold">{$_('common.edit')}</button>
        </div>
    {/if}
</section>

<AnimatedModal show={showDialog} onClose={closeDialog} dismissible={!busy} closeOnBackdrop={!busy}
    ariaLabel={$_('passwords.protection_title')} zIndex={70} panelClass="max-w-lg">
    <div class="p-5 md:p-6 space-y-4">
        <h3 class="text-lg font-bold text-slate-800 dark:text-slate-100">{$_('passwords.protection_title')}</h3>
        <p class="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{pendingEnabled ? $_('passwords.protection_warning') : $_('passwords.protection_disable')}</p>
        {#if pendingEnabled}
            <SelectMenu options={actions} bind:value={pendingAction} disabled={busy} ariaLabel={$_('passwords.protection_enable')} />
        {/if}
        <input type="password" bind:value={master} autocomplete="current-password" disabled={busy}
            aria-label={$_('passwords.old_password_label')} placeholder={$_('passwords.old_password_placeholder')}
            on:keydown={event => event.key === 'Enter' && save()}
            class="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 bg-transparent text-slate-800 dark:text-slate-100" />
        {#if error}<p role="alert" class="text-xs text-red-600">{error}</p>{/if}
        <div class="flex gap-3">
            <button on:click={closeDialog} disabled={busy} class="flex-1 px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-700">{$_('common.cancel')}</button>
            <button on:click={save} disabled={busy || !master}
                class="flex-1 px-4 py-2 rounded-xl bg-blue-600 text-white disabled:opacity-50">{busy ? $_('common.loading') : $_('common.confirm')}</button>
        </div>
    </div>
</AnimatedModal>
