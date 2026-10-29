<script>
    import { onMount } from 'svelte';
    import AnimatedModal from './AnimatedModal.svelte';
    import { showConfirm, showToast } from '../stores/modal.js';
    import { save, open } from '@tauri-apps/plugin-dialog';
    import { isTauriRuntime } from '../utils/runtime.js';
    import {
        localDatabaseInfo,
        exportLocalDatabase,
        restoreLocalDatabase,
        openLocalDatabaseFolder
    } from '../utils/local-db.js';

    export let show = false;
    export let onClose = () => {};

    let info = null;
    let busy = false;
    let error = '';

    async function refresh() {
        if (!isTauriRuntime) return;
        try {
            info = await localDatabaseInfo();
        } catch (e) {
            error = String(e?.message || e);
        }
    }

    $: if (show) refresh();

    async function exportBackup() {
        if (busy) return;
        busy = true;
        error = '';
        try {
            const defaultName = `WorkPlan-LocalDB-${new Date().toISOString().slice(0, 10)}.json`;
            const destination = await save({
                title: '导出本地数据库备份',
                defaultPath: defaultName,
                filters: [{ name: 'WorkPlan Database', extensions: ['json'] }]
            });
            if (!destination) return;
            const path = await exportLocalDatabase(destination);
            showToast({ message: `数据库备份已导出：${path}`, type: 'success', duration: 7000 });
            await refresh();
        } catch (e) {
            error = String(e?.message || e);
        } finally {
            busy = false;
        }
    }

    async function restoreBackup() {
        if (busy) return;
        error = '';
        try {
            const selected = await open({
                title: '选择本地数据库备份',
                multiple: false,
                filters: [{ name: 'WorkPlan Database', extensions: ['json'] }]
            });
            if (!selected) return;
            const confirmed = await showConfirm({
                title: '恢复本地数据库',
                message: '恢复会覆盖当前本地数据库，并重新加载应用。当前数据库会先自动备份到 .workplan/backups。',
                confirmText: '恢复并重载',
                cancelText: '取消',
                variant: 'danger'
            });
            if (!confirmed) return;
            busy = true;
            await restoreLocalDatabase(selected);
            showToast({ message: '数据库已恢复，正在重新加载…', type: 'success', duration: 2000 });
            setTimeout(() => location.reload(), 400);
        } catch (e) {
            error = String(e?.message || e);
        } finally {
            busy = false;
        }
    }

    async function openFolder() {
        try {
            await openLocalDatabaseFolder();
        } catch (e) {
            error = String(e?.message || e);
        }
    }
</script>

<AnimatedModal {show} onClose={onClose} zIndex={95} panelClass="max-w-lg">
    <div class="p-6">
        <div class="flex items-start justify-between gap-3">
            <div>
                <h3 class="text-lg font-black text-slate-800 dark:text-slate-100">数据修复工具</h3>
                <p class="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    本地数据库位于用户目录的隐藏文件夹 <code class="rounded bg-slate-100 px-1 py-0.5 dark:bg-slate-700">.workplan</code>，
                    每次保存前会自动保留备份。
                </p>
            </div>
            <button on:click={onClose} aria-label="关闭" class="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">
                <i class="ph ph-x text-lg"></i>
            </button>
        </div>

        {#if !isTauriRuntime}
            <div class="mt-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-700">
                网页版没有用户目录数据库，此工具仅在桌面版可用。请使用侧边栏的加密备份。
            </div>
        {:else}
            <div class="mt-4 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
                <div class="flex justify-between gap-3">
                    <span class="text-slate-400">数据库</span>
                    <span class="break-all text-right font-mono">{info?.path || '读取中…'}</span>
                </div>
                <div class="flex justify-between"><span class="text-slate-400">大小</span><span>{info ? `${(info.bytes / 1024).toFixed(1)} KB` : '-'}</span></div>
                <div class="flex justify-between"><span class="text-slate-400">自动备份</span><span>{info?.backups ?? '-'} 份</span></div>
                <div class="flex justify-between"><span class="text-slate-400">状态</span><span>{info?.exists ? '已创建' : '尚未创建'}</span></div>
            </div>

            <div class="mt-4 grid gap-2 sm:grid-cols-2">
                <button on:click={exportBackup} disabled={busy}
                    class="flex items-center justify-center gap-2 rounded-xl bg-slate-800 px-3 py-2.5 text-xs font-bold text-white transition hover:bg-slate-900 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
                    <i class="ph ph-download-simple text-base"></i>导出到自定义目录
                </button>
                <button on:click={restoreBackup} disabled={busy}
                    class="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
                    <i class="ph ph-upload-simple text-base"></i>从备份恢复
                </button>
                <button on:click={openFolder} disabled={busy}
                    class="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 sm:col-span-2">
                    <i class="ph ph-folder-open text-base"></i>打开数据目录
                </button>
            </div>

            <div class="mt-4 rounded-xl bg-blue-50 p-3 text-[10px] leading-relaxed text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
                <p class="font-bold">回退旧版本怎么办？</p>
                <p class="mt-1">先在这里导出数据库备份并保存到自定义目录，再安装旧版本。旧版本仍会读取本地 WebView 缓存；如果旧版本读不到数据，可重新安装当前版本，用同一备份恢复后再导出兼容数据。</p>
            </div>
        {/if}

        {#if error}
            <div class="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[11px] text-rose-600 dark:bg-rose-900/20 dark:text-rose-300">
                <i class="ph ph-warning-circle mr-1"></i>{error}
            </div>
        {/if}
    </div>
</AnimatedModal>
