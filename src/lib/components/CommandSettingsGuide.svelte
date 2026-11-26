<script>
    import { _ } from 'svelte-i18n';
    import { openCommandExecutionSettings } from '../stores/settings-navigation.js';

    export let content = '';
</script>

<div class="space-y-3">
    <div class="whitespace-pre-wrap break-words">{content}</div>
    <button
        on:click={openCommandExecutionSettings}
        class="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 text-xs font-bold inline-flex items-center gap-1.5"
    >
        <i class="ph ph-gear"></i>
        {$_('settings.command_execution_open_settings')}
    </button>
</div>
