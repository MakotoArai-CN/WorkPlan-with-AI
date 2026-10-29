<script>
    import { _ } from 'svelte-i18n';
    import AnimatedModal from './AnimatedModal.svelte';
    import { showToast, showConfirm } from '../stores/modal.js';
    import { exportBackupPackage, describeSavedLocation } from '../utils/export.js';
    import {
        backupFileName,
        collectLocalBackupPayload,
        createEncryptedBackup,
        isEncryptedBackup,
        openEncryptedBackup,
        applyLocalBackupPayload
    } from '../utils/backup-package.js';

    export let show = false;
    export let mode = 'export';
    export let onClose = () => {};

    let password = '';
    let confirmPassword = '';
    let busy = false;
    let error = '';
    let packageValue = null;
    let fileName = '';
    let fileInput;

    $: if (show) {
        password = '';
        confirmPassword = '';
        error = '';
        busy = false;
        packageValue = null;
        fileName = '';
    }

    function close() {
        if (busy) return;
        onClose();
    }

    async function doExport() {
        if (busy) return;
        if (password.length < 8) {
            error = $_('settings.secure_backup_hint');
            return;
        }
        if (password !== confirmPassword) {
            error = $_('passwords.master_mismatch');
            return;
        }
        busy = true;
        error = '';
        try {
            const payload = collectLocalBackupPayload();
            const packageValue = await createEncryptedBackup(payload, password);
            const result = await exportBackupPackage(packageValue, backupFileName());
            if (result?.cancelled) {
                showToast({ message: $_('common.cancel'), type: 'info' });
                return;
            }
            if (!result?.success) throw new Error(result?.error || '导出失败');
            const location = describeSavedLocation(result.path);
            showToast({
                message: location ? `${$_('settings.secure_backup_success')}：${location}` : $_('settings.secure_backup_success'),
                type: 'success',
                duration: 6000
            });
            onClose();
        } catch (e) {
            error = String(e?.message || e || '导出失败');
        } finally {
            busy = false;
        }
    }

    async function handleFile(event) {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        error = '';
        packageValue = null;
        fileName = file.name;
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            if (!isEncryptedBackup(parsed)) {
                throw new Error($_('settings.secure_backup_legacy'));
            }
            packageValue = parsed;
        } catch (e) {
            error = String(e?.message || e || $_('settings.secure_backup_legacy'));
        }
    }

    async function doImport() {
        if (busy || !packageValue) return;
        busy = true;
        error = '';
        try {
            const payload = await openEncryptedBackup(packageValue, password);
            const confirmed = await showConfirm({
                title: $_('settings.secure_backup_title'),
                message: $_('settings.secure_backup_restore_warning'),
                confirmText: $_('common.confirm'),
                cancelText: $_('common.cancel'),
                variant: 'danger'
            });
            if (!confirmed) return;
            await applyLocalBackupPayload(payload);
            showToast({ message: $_('settings.secure_backup_imported'), type: 'success', duration: 2200 });
            setTimeout(() => location.reload(), 450);
        } catch (e) {
            error = String(e?.message || e || $_('settings.secure_backup_wrong'));
        } finally {
            busy = false;
        }
    }
</script>

<AnimatedModal {show} onClose={close} zIndex={90} panelClass="max-w-md">
    <div class="p-6">
        <div class="flex items-start gap-3 mb-5">
            <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-lg shadow-amber-500/20">
                <i class="ph-fill ph-shield-check text-xl"></i>
            </div>
            <div class="min-w-0 flex-1">
                <h3 class="text-lg font-black tracking-tight text-slate-800 dark:text-slate-100">
                    {$_('settings.secure_backup_title')}
                </h3>
                <p class="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    {$_('settings.secure_backup_desc')}
                </p>
            </div>
            <button on:click={close} aria-label={$_('common.close')}
                class="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700">
                <i class="ph ph-x text-lg"></i>
            </button>
        </div>

        {#if mode === 'export'}
            <div class="space-y-3">
                <label class="block">
                    <span class="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">{$_('settings.secure_backup_password')}</span>
                    <input type="password" bind:value={password} autocomplete="new-password"
                        class="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100 dark:border-slate-600 dark:bg-slate-950/60 dark:text-slate-100" />
                </label>
                <label class="block">
                    <span class="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">{$_('settings.secure_backup_confirm')}</span>
                    <input type="password" bind:value={confirmPassword} autocomplete="new-password"
                        on:keydown={(event) => event.key === 'Enter' && doExport()}
                        class="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100 dark:border-slate-600 dark:bg-slate-950/60 dark:text-slate-100" />
                </label>
                <p class="text-[10px] leading-relaxed text-slate-400">{$_('settings.secure_backup_hint')}</p>
                <p class="rounded-lg bg-amber-50 px-3 py-2 text-[10px] leading-relaxed text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                    <i class="ph ph-info mr-1"></i>{$_('settings.secure_backup_sync_hint')}
                </p>
            </div>
        {:else}
            <div class="space-y-3">
                <input bind:this={fileInput} type="file" accept=".wpb,.json" on:change={handleFile} class="hidden" />
                <button on:click={() => fileInput?.click()} disabled={busy}
                    class="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm font-bold text-slate-500 transition hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-950/40 dark:text-slate-300 dark:hover:border-amber-700 dark:hover:bg-amber-900/20">
                    <i class="ph ph-file-arrow-up text-xl"></i>
                    {fileName || $_('settings.secure_backup_choose')}
                </button>
                {#if packageValue}
                    <p class="text-[10px] text-emerald-600 dark:text-emerald-400">
                        <i class="ph-fill ph-check-circle mr-1"></i>{$_('settings.secure_backup_ready')}
                    </p>
                {/if}
                <label class="block">
                    <span class="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">{$_('settings.secure_backup_password')}</span>
                    <input type="password" bind:value={password} autocomplete="current-password"
                        on:keydown={(event) => event.key === 'Enter' && doImport()}
                        class="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100 dark:border-slate-600 dark:bg-slate-950/60 dark:text-slate-100" />
                </label>
            </div>
        {/if}

        {#if error}
            <div class="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[11px] text-rose-600 dark:bg-rose-900/20 dark:text-rose-300">
                <i class="ph ph-warning-circle mr-1"></i>{error}
            </div>
        {/if}

        <div class="mt-5 flex gap-2">
            <button on:click={close} disabled={busy}
                class="flex-1 rounded-xl bg-slate-100 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-700 dark:text-slate-200">
                {$_('common.cancel')}
            </button>
            {#if mode === 'export'}
                <button on:click={doExport} disabled={busy}
                    class="flex-1 rounded-xl bg-amber-600 py-2.5 text-sm font-bold text-white transition hover:bg-amber-700 disabled:opacity-60">
                    {#if busy}<i class="ph ph-spinner animate-spin mr-1"></i>{/if}{$_('settings.secure_backup_export')}
                </button>
            {:else}
                <button on:click={doImport} disabled={busy || !packageValue}
                    class="flex-1 rounded-xl bg-amber-600 py-2.5 text-sm font-bold text-white transition hover:bg-amber-700 disabled:opacity-50">
                    {#if busy}<i class="ph ph-spinner animate-spin mr-1"></i>{/if}{$_('settings.secure_backup_verify')}
                </button>
            {/if}
        </div>
    </div>
</AnimatedModal>
