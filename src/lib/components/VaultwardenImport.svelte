<script>
    import { _ } from 'svelte-i18n';
    import { importFromVaultwarden } from '../utils/vaultwarden.js';

    export let show = false;
    export let onClose = () => {};
    export let onImported = () => {};

    let baseUrl = '';
    let email = '';
    let masterPassword = '';
    let showPassword = false;
    let loading = false;
    let error = '';
    let result = null;

    async function doImport() {
        if (loading) return;
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
            onImported(imported.items);
        } catch (e) {
            error = e.message || String(e);
        } finally {
            loading = false;
        }
    }

    function close() {
        if (loading) return;
        masterPassword = '';
        error = '';
        result = null;
        onClose();
    }
</script>

{#if show}
    <div class="fixed inset-0 z-[60] flex items-center justify-center p-4">
        <div
            class="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            on:click={close}
            on:keydown={(event) => event.key === 'Escape' && close()}
            role="button"
            tabindex="0"
        ></div>
        <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md relative flex flex-col max-h-[90vh] overflow-hidden">
            <div class="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-900/40">
                <div>
                    <h3 class="font-bold text-lg text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <i class="ph-fill ph-key text-amber-600"></i> {$_('passwords.vaultwarden_title')}
                    </h3>
                    <div class="text-[10px] text-slate-500 mt-0.5">{$_('passwords.vaultwarden_desc')}</div>
                </div>
                <button on:click={close} aria-label={$_('common.cancel')}><i class="ph ph-x text-xl"></i></button>
            </div>

            <div class="flex-1 overflow-y-auto p-6 space-y-4">
                <label class="flex flex-col gap-1">
                    <span class="text-xs font-bold text-slate-500">{$_('passwords.vaultwarden_server')}</span>
                    <input bind:value={baseUrl} placeholder="https://vault.example.com"
                        class="border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-sm" />
                    <div class="flex flex-wrap gap-1.5 mt-1">
                        <button type="button" on:click={() => baseUrl = 'https://vault.bitwarden.com'}
                            class="px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-700 text-[10px] font-bold text-slate-500 dark:text-slate-300 hover:bg-amber-50 hover:text-amber-700">
                            {$_('passwords.vaultwarden_bitwarden_com')}
                        </button>
                        <button type="button" on:click={() => baseUrl = 'https://vault.bitwarden.eu'}
                            class="px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-700 text-[10px] font-bold text-slate-500 dark:text-slate-300 hover:bg-amber-50 hover:text-amber-700">
                            {$_('passwords.vaultwarden_bitwarden_eu')}
                        </button>
                    </div>
                </label>
                <label class="flex flex-col gap-1">
                    <span class="text-xs font-bold text-slate-500">{$_('passwords.vaultwarden_email')}</span>
                    <input bind:value={email} type="email" autocomplete="username"
                        class="border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-sm" />
                </label>
                <label class="flex flex-col gap-1">
                    <span class="text-xs font-bold text-slate-500">{$_('passwords.vaultwarden_master')}</span>
                    <div class="relative">
                        <input bind:value={masterPassword} type={showPassword ? 'text' : 'password'} autocomplete="current-password"
                            class="w-full border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 pr-10 bg-white dark:bg-slate-900 text-sm" />
                        <button type="button" on:click={() => showPassword = !showPassword}
                            class="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                            aria-label={$_('passwords.show_password')}>
                            <i class={`ph ${showPassword ? 'ph-eye-slash' : 'ph-eye'}`}></i>
                        </button>
                    </div>
                </label>

                <div class="text-[10px] text-slate-500 bg-slate-50 dark:bg-slate-900/40 rounded-lg p-3 leading-5">
                    {$_('passwords.vaultwarden_hint')}
                </div>

                {#if error}
                    <div class="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg p-3 break-words">{error}</div>
                {/if}
                {#if result && result.items.length}
                    <div class="text-xs text-green-600">
                        {$_('passwords.vaultwarden_success', { values: { count: result.items.length } })}
                    </div>
                {/if}
            </div>

            <div class="px-6 py-4 border-t border-slate-100 dark:border-slate-700 flex gap-3">
                <button on:click={close} disabled={loading}
                    class="flex-1 py-2.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 rounded-xl font-bold text-sm">
                    {$_('common.cancel')}
                </button>
                <button on:click={doImport} disabled={loading}
                    class="flex-1 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2">
                    {#if loading}
                        <i class="ph ph-spinner animate-spin"></i> {$_('passwords.vaultwarden_importing')}
                    {:else}
                        <i class="ph ph-download-simple"></i> {$_('passwords.vaultwarden_import')}
                    {/if}
                </button>
            </div>
        </div>
    </div>
{/if}
