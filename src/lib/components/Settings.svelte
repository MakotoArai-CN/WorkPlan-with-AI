<script>
    import { settingsStore } from '../stores/settings.js';
    import { invoke } from '@tauri-apps/api/core';
    import { showAlert, showConfirm } from '../stores/modal.js';

    let checkingUpdate = false;

    async function toggleAutoStart() {
        try {
            await settingsStore.toggleAutoStart();
        } catch (error) {
            await showAlert({ title: '设置失败', message: '设置自启动失败：' + error, variant: 'danger' });
        }
    }

    async function toggleCloseToQuit() {
        try {
            await settingsStore.toggleCloseToQuit();
        } catch (error) {
            await showAlert({ title: '设置失败', message: '设置失败：' + error, variant: 'danger' });
        }
    }

    async function testNotification() {
        try {
            await settingsStore.testNotification();
        } catch (error) {
            await showAlert({ title: '测试失败', message: '通知测试失败：' + error.message, variant: 'danger' });
        }
    }

    async function checkUpdate() {
        checkingUpdate = true;
        try {
            const data = await invoke('check_update');
            if (data && data.tag_name) {
                const latestVersion = data.tag_name.replace('v', '');
                const currentVersion = $settingsStore.appVersion;
                if (latestVersion !== currentVersion) {
                    const confirmed = await showConfirm({
                        title: '发现新版本',
                        message: `发现新版本 ${latestVersion}，当前版本 ${currentVersion}。是否前往下载？`,
                        confirmText: '前往下载',
                        cancelText: '稍后再说',
                        variant: 'success'
                    });
                    if (confirmed) {
                        await invoke('open_releases');
                    }
                } else {
                    await showAlert({ title: '检查更新', message: '当前已是最新版本！', variant: 'success' });
                }
            } else {
                await showAlert({ title: '检查更新', message: '无法获取版本信息', variant: 'warning' });
            }
        } catch (error) {
            await showAlert({ title: '检查失败', message: '检查更新失败：' + error, variant: 'danger' });
        } finally {
            checkingUpdate = false;
        }
    }

    async function openGithub() {
        await invoke('open_github');
    }

    function showAgreement() {
        settingsStore.showAgreementModal();
    }
</script>

<header class="h-16 bg-white/90 backdrop-blur px-6 flex justify-between items-center z-10 sticky top-0 border-b border-slate-200 shrink-0">
    <div>
        <h2 class="text-lg font-bold text-slate-800">系统设置</h2>
        <div class="text-xs text-slate-500">应用配置与管理</div>
    </div>
</header>

<div class="flex-1 overflow-y-auto p-6 space-y-6 min-h-0 pb-40">
    {#if $settingsStore.notificationAvailable}
        <div class="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
            <div class="px-6 py-4 border-b border-slate-50 font-bold text-slate-700 flex items-center gap-2">
                <i class="ph ph-bell text-lg"></i> 通知设置
            </div>
            <div class="p-6 space-y-4">
                <div class="flex items-center justify-between">
                    <div>
                        <div class="font-bold text-slate-700">系统通知</div>
                        <div class="text-xs text-slate-500">开机后提醒今日任务</div>
                    </div>
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" checked={$settingsStore.enableNotification}
                            on:change={settingsStore.toggleNotification} class="sr-only peer">
                        <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                </div>
                {#if $settingsStore.enableNotification}
                    <div class="pl-4 border-l-2 border-blue-100">
                        <button on:click={testNotification}
                            class="text-xs text-blue-600 hover:text-blue-700 font-bold flex items-center gap-1">
                            <i class="ph ph-play"></i> 测试通知
                        </button>
                    </div>
                {/if}
            </div>
        </div>
    {/if}

    <div class="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div class="px-6 py-4 border-b border-slate-50 font-bold text-slate-700 flex items-center gap-2">
            <i class="ph ph-sparkle text-lg"></i> AI 功能
        </div>
        <div class="p-6 space-y-4">
            <div class="flex items-center justify-between">
                <div>
                    <div class="font-bold text-slate-700">AI 报告生成</div>
                    <div class="text-xs text-slate-500">在数据统计中使用 AI 生成日报/周报</div>
                </div>
                <label class="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" checked={$settingsStore.enableAiSummary}
                        on:change={settingsStore.toggleAiSummary} class="sr-only peer">
                    <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
            </div>
        </div>
    </div>

    <div class="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div class="px-6 py-4 border-b border-slate-50 font-bold text-slate-700 flex items-center gap-2">
            <i class="ph ph-power text-lg"></i> 启动设置
        </div>
        <div class="p-6 space-y-4">
            <div class="flex items-center justify-between">
                <div>
                    <div class="font-bold text-slate-700">开机自启动</div>
                    <div class="text-xs text-slate-500">登录系统时自动启动程序</div>
                </div>
                <label class="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" checked={$settingsStore.autoStart}
                        on:change={toggleAutoStart}
                        disabled={$settingsStore.autoStartLoading}
                        class="sr-only peer">
                    <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600 peer-disabled:opacity-50"></div>
                </label>
            </div>
            {#if $settingsStore.autoStartLoading}
                <div class="text-xs text-slate-500 flex items-center gap-2">
                    <i class="ph ph-spinner animate-spin"></i> 正在配置...
                </div>
            {/if}
        </div>
    </div>

    <div class="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div class="px-6 py-4 border-b border-slate-50 font-bold text-slate-700 flex items-center gap-2">
            <i class="ph ph-x-circle text-lg"></i> 窗口行为
        </div>
        <div class="p-6 space-y-4">
            <div class="flex items-center justify-between">
                <div>
                    <div class="font-bold text-slate-700">关闭时彻底退出</div>
                    <div class="text-xs text-slate-500">关闭窗口时直接退出程序，而不是最小化到托盘</div>
                </div>
                <label class="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" checked={$settingsStore.closeToQuit}
                        on:change={toggleCloseToQuit}
                        class="sr-only peer">
                    <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-500"></div>
                </label>
            </div>
        </div>
    </div>

    <div class="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div class="px-6 py-4 border-b border-slate-50 font-bold text-slate-700 flex items-center gap-2">
            <i class="ph ph-info text-lg"></i> 关于
        </div>
        <div class="p-6 space-y-4">
            <div class="flex items-center gap-4">
                <div class="w-16 h-16 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg">
                    <i class="ph-bold ph-check-square-offset text-3xl"></i>
                </div>
                <div class="flex-1">
                    <h3 class="text-xl font-bold text-slate-800">WorkPlan  with AI</h3>
                    <div class="text-sm text-slate-500">版本 {$settingsStore.appVersion}</div>
                </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
                <button on:click={openGithub}
                    class="flex items-center justify-center gap-2 py-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-sm font-bold text-slate-700 transition">
                    <i class="ph ph-github-logo text-lg"></i> GitHub
                </button>
                <button on:click={checkUpdate} disabled={checkingUpdate}
                    class="flex items-center justify-center gap-2 py-3 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg text-sm font-bold text-blue-700 transition disabled:opacity-50">
                    <i class="ph text-lg" class:ph-spinner={checkingUpdate} class:animate-spin={checkingUpdate} class:ph-download-simple={!checkingUpdate}></i>
                    {checkingUpdate ? '检查中...' : '检查更新'}
                </button>
            </div>
            <button on:click={showAgreement}
                class="w-full flex items-center justify-center gap-2 py-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-sm font-bold text-slate-600 transition">
                <i class="ph ph-scroll text-lg"></i> 查看用户协议与隐私政策
            </button>
        </div>
    </div>

    <div class="text-center text-xs text-slate-400 py-4">
        Made with ❤️ by MakotoArai-CN
    </div>
</div>