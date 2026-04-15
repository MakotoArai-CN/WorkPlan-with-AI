<script>
    import { settingsStore } from '../stores/settings.js';
    import { _ } from 'svelte-i18n';

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

{#if shouldShow}
    <div class="fixed inset-0 z-[200] flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            on:click={handleClose} on:keydown={handleClose} role="button" tabindex="0"></div>
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl relative flex flex-col max-h-[90vh] overflow-hidden">
            <div class="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-blue-50 shrink-0">
                <h3 class="font-bold text-lg text-blue-800 flex items-center gap-2">
                    <i class="ph ph-scroll"></i> {$_('agreement_page.title')}
                </h3>
                {#if !isFirstTime}
                    <button on:click={handleClose} class="text-slate-500 hover:text-slate-700">
                        <i class="ph ph-x text-xl"></i>
                    </button>
                {/if}
            </div>

            <div class="flex-1 overflow-y-auto p-6 space-y-6 text-sm text-slate-700 leading-relaxed">
                <section>
                    <h4 class="font-bold text-base text-slate-800 mb-3">{$_('agreement_page.user_tab')}</h4>
                    <div class="space-y-3 text-slate-600">
                        <p>{$_('agreement_page.user_intro')}</p>

                        <p><strong>{$_('agreement_page.service_title')}</strong></p>
                        <p>{$_('agreement_page.service_desc')}</p>

                        <p><strong>{$_('agreement_page.user_resp_title')}</strong></p>
                        <p>{$_('agreement_page.user_resp_desc')}</p>

                        <p><strong>{$_('agreement_page.ip_title')}</strong></p>
                        <p>{$_('agreement_page.ip_desc')}</p>

                        <p><strong>{$_('agreement_page.disclaimer_title')}</strong></p>
                        <p>{$_('agreement_page.disclaimer_desc')}</p>

                        <p><strong>{$_('agreement_page.ai_title')}</strong></p>
                        <p>{$_('agreement_page.ai_desc')}</p>
                    </div>
                </section>

                <section>
                    <h4 class="font-bold text-base text-slate-800 mb-3">{$_('agreement_page.privacy_tab')}</h4>
                    <div class="space-y-3 text-slate-600">
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

                <section class="bg-amber-50 border border-amber-200 rounded-lg p-4">
                    <p class="text-amber-800 text-xs">
                        <i class="ph ph-warning-circle"></i>
                        {#if isFirstTime}
                            {$_('agreement_page.agree_hint')}
                        {:else}
                            {$_('agreement_page.agreed')}
                        {/if}
                    </p>
                </section>
            </div>

            <div class="p-4 border-t border-slate-100 flex justify-end gap-3 bg-white shrink-0">
                {#if isFirstTime}
                    <button on:click={handleReject}
                        class="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm font-bold">
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
        </div>
    </div>
{/if}