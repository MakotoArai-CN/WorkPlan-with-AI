<script>
    import { page } from '$app/stores';
    import { _ } from 'svelte-i18n';
</script>

<div class="h-screen flex flex-col items-center justify-center bg-slate-100 dark:bg-slate-900 text-slate-800 dark:text-slate-200">
    <div class="text-6xl mb-4">😵</div>
    <h1 class="text-2xl font-bold mb-2">{$_('error_page.title')}</h1>
    <p class="text-slate-500 dark:text-slate-400 mb-4">{$_('error_page.code')}: {$page.status}</p>
    <p class="text-slate-400 dark:text-slate-500 text-sm mb-6">{$page.error?.message}</p>
    <a href="/" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
        {$_('error_page.go_home')}
    </a>
</div>