<script>
    import { currentView, taskStore, enabledScheduledCount, activeTasks } from '../stores/tasks.js';
    import { showAiPanel } from '../stores/ai.js';
    import { showConfirm, showAlert, showToast } from '../stores/modal.js';

    function switchView(view) {
        currentView.set(view);
        showAiPanel.set(false);
    }

    function exportData() {
        showToast({ message: '正在导出备份...', type: 'info', duration: 1500 });
        const data = taskStore.exportData($taskStore);
        const blob = new Blob([data], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `planpro_backup_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        showToast({ message: '备份导出成功', type: 'success' });
    }

    function handleImport(event) {
        const file = event.target.files[0];
        if (!file) return;
        showToast({ message: '正在导入数据...', type: 'info', duration: 1500 });
        const reader = new FileReader();
        reader.onload = async (e) => {
            const result = taskStore.importData(e.target.result);
            if (result.success) {
                showToast({ message: '数据导入成功', type: 'success' });
            } else {
                showToast({ message: '导入失败: ' + result.error, type: 'error' });
            }
        };
        reader.onerror = () => {
            showToast({ message: '读取文件失败', type: 'error' });
        };
        reader.readAsText(file);
        event.target.value = '';
    }

    async function logout() {
        const confirmed = await showConfirm({
            title: '切换账号',
            message: '确定要退出当前 Key 吗？',
            confirmText: '确定退出',
            cancelText: '取消',
            variant: 'warning'
        });
        if (confirmed) {
            taskStore.logout();
            showToast({ message: '已退出登录', type: 'info' });
        }
    }

    async function clearData() {
        const confirmed = await showConfirm({
            title: '删除所有数据',
            message: `警告：此操作将永久删除 [${$taskStore.accessKey}] 的所有数据，且无法恢复！`,
            confirmText: '确认删除',
            cancelText: '取消',
            variant: 'danger'
        });
        if (confirmed) {
            await taskStore.clearAllData($taskStore.accessKey);
            showToast({ message: '所有数据已清空', type: 'success' });
            location.reload();
        }
    }

    let fileInput;
</script>

<aside class="hidden md:flex w-64 bg-white border-r border-slate-200 flex-col z-20 shadow-lg shrink-0">
    <div class="p-6 flex items-center gap-3 border-b border-slate-100 h-16">
        <div class="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white shadow-md">
            <i class="ph ph-check-square-offset text-xl"></i>
        </div>
        <div class="flex-1 min-w-0">
            <h1 class="text-lg font-bold tracking-tight text-slate-800 leading-tight">WorkPlan</h1>
            <div class="text-[10px] text-slate-400 font-mono truncate" title="当前Key">🔑 {$taskStore.accessKey}</div>
        </div>
    </div>

    <div class="px-6 py-2">
        <div class="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border transition-colors"
            class:bg-blue-50={$taskStore.syncStatus === 'syncing'}
            class:text-blue-600={$taskStore.syncStatus === 'syncing'}
            class:border-blue-200={$taskStore.syncStatus === 'syncing'}
            class:bg-green-50={$taskStore.syncStatus === 'done'}
            class:text-green-600={$taskStore.syncStatus === 'done'}
            class:border-green-200={$taskStore.syncStatus === 'done'}
            class:bg-red-50={$taskStore.syncStatus === 'error'}
            class:text-red-600={$taskStore.syncStatus === 'error'}
            class:border-red-200={$taskStore.syncStatus === 'error'}
            class:bg-slate-50={$taskStore.syncStatus === 'idle'}
            class:text-slate-400={$taskStore.syncStatus === 'idle'}
            class:border-slate-200={$taskStore.syncStatus === 'idle'}>
            {#if $taskStore.syncStatus === 'syncing'}
                <i class="ph ph-spinner animate-spin"></i>
            {:else if $taskStore.syncStatus === 'done'}
                <i class="ph-bold ph-check"></i>
            {:else if $taskStore.syncStatus === 'error'}
                <i class="ph-bold ph-warning"></i>
            {:else}
                <i class="ph ph-cloud"></i>
            {/if}
            <span class="font-bold">
                {#if $taskStore.syncStatus === 'syncing'}同步中...
                {:else if $taskStore.syncStatus === 'done'}已同步
                {:else if $taskStore.syncStatus === 'error'}同步失败
                {:else}就绪{/if}
            </span>
        </div>
    </div>

    <nav class="flex-1 p-4 space-y-2">
        <button on:click={() => switchView('dashboard')}
            class="w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-sm font-bold"
            class:bg-blue-50={$currentView === 'dashboard'}
            class:text-blue-700={$currentView === 'dashboard'}
            class:text-slate-600={$currentView !== 'dashboard'}
            class:hover:bg-slate-50={$currentView !== 'dashboard'}>
            <i class="ph ph-sun text-lg"></i> 今日看板
            {#if $activeTasks.length > 0}
                <span class="ml-auto bg-blue-600 text-white text-[10px] px-2 py-0.5 rounded-full">{$activeTasks.length}</span>
            {/if}
        </button>
        <button on:click={() => switchView('templates')}
            class="w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-sm font-bold"
            class:bg-purple-50={$currentView === 'templates'}
            class:text-purple-700={$currentView === 'templates'}
            class:text-slate-600={$currentView !== 'templates'}
            class:hover:bg-slate-50={$currentView !== 'templates'}>
            <i class="ph ph-copy text-lg"></i> 任务模板
        </button>
        <button on:click={() => switchView('scheduled')}
            class="w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-sm font-bold"
            class:bg-teal-50={$currentView === 'scheduled'}
            class:text-teal-700={$currentView === 'scheduled'}
            class:text-slate-600={$currentView !== 'scheduled'}
            class:hover:bg-slate-50={$currentView !== 'scheduled'}>
            <i class="ph ph-clock-countdown text-lg"></i> 定时任务
            {#if $enabledScheduledCount > 0}
                <span class="ml-auto bg-teal-100 text-teal-700 text-[10px] px-2 py-0.5 rounded-full">{$enabledScheduledCount}</span>
            {/if}
        </button>
        <button on:click={() => switchView('statistics')}
            class="w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-sm font-bold"
            class:bg-indigo-50={$currentView === 'statistics'}
            class:text-indigo-700={$currentView === 'statistics'}
            class:text-slate-600={$currentView !== 'statistics'}
            class:hover:bg-slate-50={$currentView !== 'statistics'}>
            <i class="ph ph-chart-bar text-lg"></i> 数据统计
        </button>
        <button on:click={() => switchView('notes')}
            class="w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-sm font-bold"
            class:bg-emerald-50={$currentView === 'notes'}
            class:text-emerald-700={$currentView === 'notes'}
            class:text-slate-600={$currentView !== 'notes'}
            class:hover:bg-slate-50={$currentView !== 'notes'}>
            <i class="ph ph-notebook text-lg"></i> 工作笔记
        </button>
        <button on:click={() => switchView('aichat')}
            class="w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-sm font-bold"
            class:bg-gradient-to-r={$currentView === 'aichat'}
            class:from-indigo-50={$currentView === 'aichat'}
            class:to-purple-50={$currentView === 'aichat'}
            class:text-indigo-700={$currentView === 'aichat'}
            class:text-slate-600={$currentView !== 'aichat'}
            class:hover:bg-slate-50={$currentView !== 'aichat'}>
            <i class="ph ph-robot text-lg"></i> AI Chat
        </button>
        <button on:click={() => switchView('passwords')}
            class="w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-sm font-bold"
            class:bg-amber-50={$currentView === 'passwords'}
            class:text-amber-700={$currentView === 'passwords'}
            class:text-slate-600={$currentView !== 'passwords'}
            class:hover:bg-slate-50={$currentView !== 'passwords'}>
            <i class="ph ph-key text-lg"></i> 密码管理
        </button>
        <button on:click={() => switchView('settings')}
            class="w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-sm font-bold"
            class:bg-slate-100={$currentView === 'settings'}
            class:text-slate-700={$currentView === 'settings'}
            class:text-slate-600={$currentView !== 'settings'}
            class:hover:bg-slate-50={$currentView !== 'settings'}>
            <i class="ph ph-gear text-lg"></i> 系统设置
        </button>
    </nav>

    <div class="p-4 border-t border-slate-100 bg-slate-50">
        <div class="text-[10px] font-bold text-slate-400 uppercase mb-2">系统管理</div>
        <div class="grid grid-cols-2 gap-2">
            <button on:click={exportData}
                class="flex items-center justify-center gap-1 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-600 hover:text-blue-600">
                <i class="ph ph-download-simple"></i> 备份
            </button>
            <button on:click={() => fileInput.click()}
                class="flex items-center justify-center gap-1 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-600 hover:text-blue-600">
                <i class="ph ph-upload-simple"></i> 恢复
            </button>
            <button on:click={logout}
                class="col-span-2 flex items-center justify-center gap-1 py-2 bg-white border border-red-100 rounded-lg text-xs text-red-500 hover:bg-red-50 font-bold">
                <i class="ph-bold ph-sign-out"></i> 切换账号
            </button>
            <button on:click={clearData}
                class="col-span-2 flex items-center justify-center gap-1 py-2 text-[10px] text-slate-400 hover:text-red-600 mt-1">
                <i class="ph ph-trash"></i> 删库跑路
            </button>
            <input type="file" bind:this={fileInput} on:change={handleImport} class="hidden" accept=".json">
        </div>
    </div>
</aside>