<script>
    import { settingsStore } from '../stores/settings.js';
    import { _ } from 'svelte-i18n';
    import AnimatedModal from './AnimatedModal.svelte';

    export let isFirstTime = false;

    async function handleAccept() {
        settingsStore.acceptAgreement();
    }

    async function handleReject() {
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('exit_app');
        } catch {
            window.close();
        }
    }

    function handleClose() {
        if (!isFirstTime) {
            settingsStore.hideAgreementModal();
        }
    }

    $: shouldShow = isFirstTime || $settingsStore.showAgreement;
</script>

<AnimatedModal show={shouldShow} onClose={handleClose} zIndex={200} panelClass="max-w-2xl"
    dismissible={!isFirstTime} closeOnBackdrop={!isFirstTime}>
    <div class="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-blue-50 dark:bg-slate-900/50 shrink-0">
        <div>
            <h3 class="font-bold text-lg text-blue-800 dark:text-blue-200 flex items-center gap-2">
                <i class="ph ph-scroll"></i> {$_('agreement_page.title')}
            </h3>
            <div class="text-[10px] text-blue-600/70 dark:text-slate-400 mt-0.5">{$_('agreement_page.updated_at')}</div>
        </div>
        {#if !isFirstTime}
            <button on:click={handleClose} class="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                aria-label={$_('agreement_page.close')}>
                <i class="ph ph-x text-xl"></i>
            </button>
        {/if}
    </div>

    <div class="flex-1 overflow-y-auto p-6 space-y-6 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
        <section>
            <h4 class="font-bold text-base text-slate-800 dark:text-slate-100 mb-3">{$_('agreement_page.user_tab')}</h4>
            <div class="space-y-3 text-slate-600 dark:text-slate-300">
                <p>{$_('agreement_page.user_intro')}</p>

                <p><strong>{$_('agreement_page.service_title')}</strong></p>
                <p>{$_('agreement_page.service_desc')}</p>

                <p><strong>{$_('agreement_page.account_title')}</strong></p>
                <p>{$_('agreement_page.account_desc')}</p>

                <p><strong>{$_('agreement_page.sync_title')}</strong></p>
                <p>{$_('agreement_page.sync_desc')}</p>

                <p><strong>{$_('agreement_page.vault_title')}</strong></p>
                <p>{$_('agreement_page.vault_desc')}</p>

                <p><strong>{$_('agreement_page.user_resp_title')}</strong></p>
                <p>{$_('agreement_page.user_resp_desc')}</p>

                <p><strong>{$_('agreement_page.ai_title')}</strong></p>
                <p>{$_('agreement_page.ai_desc')}</p>

                <p><strong>{$_('agreement_page.worklog_title')}</strong></p>
                <p>{$_('agreement_page.worklog_desc')}</p>

                <p><strong>{$_('agreement_page.ip_title')}</strong></p>
                <p>{$_('agreement_page.ip_desc')}</p>

                <p><strong>{$_('agreement_page.disclaimer_title')}</strong></p>
                <p>{$_('agreement_page.disclaimer_desc')}</p>

                <p><strong>{$_('agreement_page.changes_title')}</strong></p>
                <p>{$_('agreement_page.changes_desc')}</p>
            </div>
        </section>

        <section class="border-t border-slate-100 dark:border-slate-700 pt-5">
            <h4 class="font-bold text-base text-slate-800 dark:text-slate-100 mb-3">{$_('agreement_page.privacy_tab')}</h4>
            <div class="space-y-3 text-slate-600 dark:text-slate-300">
                <p><strong>{$_('agreement_page.collect_title')}</strong></p>
                <p>{$_('agreement_page.collect_desc')}</p>

                <p><strong>{$_('agreement_page.usage_title')}</strong></p>
                <p>{$_('agreement_page.usage_desc')}</p>

                <p><strong>{$_('agreement_page.storage_title')}</strong></p>
                <p>{$_('agreement_page.storage_desc')}</p>

                <p><strong>{$_('agreement_page.sharing_title')}</strong></p>
                <p>{$_('agreement_page.sharing_desc')}</p>

                <p><strong>{$_('agreement_page.security_title')}</strong></p>
                <p>{$_('agreement_page.security_desc')}</p>

                <p><strong>{$_('agreement_page.rights_title')}</strong></p>
                <p>{$_('agreement_page.rights_desc')}</p>
            </div>
        </section>

        <section class="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/60 rounded-lg p-4">
            <p class="text-amber-800 dark:text-amber-200 text-xs">
                <i class="ph ph-warning-circle"></i>
                {#if isFirstTime}
                    {$_('agreement_page.agree_hint')}
                {:else}
                    {$_('agreement_page.agreed')}
                {/if}
            </p>
        </section>
    </div>

    <div class="p-4 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-3 bg-white dark:bg-slate-800 shrink-0">
        {#if isFirstTime}
            <button on:click={handleReject}
                class="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-sm font-bold">
                {$_('agreement_page.decline')}
            </button>
            <button on:click={handleAccept}
                class="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-bold shadow">
                {$_('agreement_page.agree')}
            </button>
        {:else}
            <button on:click={handleClose}
                class="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-bold shadow">
                {$_('agreement_page.close')}
            </button>
        {/if}
    </div>
</AnimatedModal>
