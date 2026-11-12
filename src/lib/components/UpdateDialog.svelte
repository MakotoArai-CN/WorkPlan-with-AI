<script>
    import AnimatedModal from './AnimatedModal.svelte';
    import MarkdownRenderer from './MarkdownRenderer.svelte';
    import { updateDialog, closeUpdateDialog, checkForUpdates } from '../stores/updates.js';
    import { settingsStore } from '../stores/settings.js';
    import { getReleaseDate, getReleaseNotes, officialReleaseUrl, publicReleaseNotes } from '../utils/release-history.js';
    import { openExternalUrl } from '../utils/open-external.js';
    import { _, locale } from 'svelte-i18n';

    const bundledVersion = typeof __WORKPLAN_VERSION__ === 'string' ? __WORKPLAN_VERSION__ : '';
    let opening = false;
    let openError = '';
    $: currentVersion = $settingsStore.appVersion || bundledVersion;
    $: version = $updateDialog.data?.latest_version || currentVersion;
    $: notes = $updateDialog.data
        ? publicReleaseNotes($updateDialog.data.release_notes) || getReleaseNotes(version, $locale)
        : getReleaseNotes(currentVersion, $locale);
    $: title = $updateDialog.currentOnly ? $_('settings.release_notes') : $_('settings.check_update');
    $: dateValue = $updateDialog.data?.published_at || `${getReleaseDate(version)}T00:00:00`;
    $: published = dateValue ? new Date(dateValue) : null;
    $: publishedLabel = published && !Number.isNaN(published.getTime()) ? published.toLocaleDateString($locale || 'zh') : '';

    async function openRelease() {
        const url = officialReleaseUrl(version);
        if (!url || opening) return;
        opening = true;
        openError = '';
        try {
            if (!await openExternalUrl(url)) openError = $_('settings.release_open_failed');
        } catch { openError = $_('settings.release_open_failed'); }
        finally { opening = false; }
    }
</script>

<AnimatedModal show={$updateDialog.show} onClose={closeUpdateDialog} zIndex={85}
    ariaLabel={title} panelClass="max-w-2xl">
    <div class="p-5 md:p-6 border-b border-slate-100 dark:border-slate-700 shrink-0">
        <h2 class="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><i class="ph ph-download-simple text-blue-600" aria-hidden="true"></i>{title}</h2>
        <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">{$_('settings.current_version')}: {currentVersion}</p>
    </div>
    <div class="p-5 md:p-6 space-y-4 overflow-y-auto min-h-0">
        {#if $updateDialog.loading}
            <p role="status" class="text-sm text-slate-500">{$_('common.loading')}</p>
        {:else}
            {#if $updateDialog.error}
                <p role="alert" class="text-sm text-red-600">{$updateDialog.error}</p>
                <p class="text-xs text-slate-500">{$_('settings.release_offline_hint')}</p>
            {:else if $updateDialog.data}
                <p role="status" class="text-sm font-bold text-slate-700 dark:text-slate-200">{$updateDialog.data.has_update ? $_('settings.update_available') : $_('settings.up_to_date')}</p>
            {/if}
            <div class="flex items-baseline justify-between gap-3 flex-wrap">
                <h3 class="font-bold text-slate-800 dark:text-slate-100">{$_('settings.release_notes')} · {version}</h3>
                {#if publishedLabel}<span class="text-xs text-slate-500">{$_('settings.release_date')}: {publishedLabel}</span>{/if}
            </div>
            {#if notes}
                <MarkdownRenderer content={notes} />
            {:else}
                <p class="text-sm text-slate-500">{$_('settings.release_notes_empty')}</p>
            {/if}
            {#if openError}<p role="alert" class="text-sm text-red-600">{openError}</p>{/if}
        {/if}
    </div>
    <div class="p-4 md:px-6 flex justify-end gap-3 border-t border-slate-100 dark:border-slate-700 shrink-0">
        <button on:click={closeUpdateDialog} class="px-4 py-2 text-sm rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200">{$_('common.close')}</button>
        {#if $updateDialog.error}
            <button on:click={checkForUpdates} class="px-4 py-2 rounded-xl text-sm bg-blue-600 text-white">{$_('ai.retry')}</button>
        {:else if !$updateDialog.loading && officialReleaseUrl(version)}
            <button on:click={openRelease} disabled={opening} class="px-4 py-2 rounded-xl text-sm bg-blue-600 text-white disabled:opacity-50">{$updateDialog.data?.has_update ? $_('settings.download') : $_('settings.view_release')}</button>
        {/if}
    </div>
</AnimatedModal>
