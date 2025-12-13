<script>
    import { currentView } from '../stores/tasks.js';
    import { showAiPanel } from '../stores/ai.js';

    function switchView(view) {
        currentView.set(view);
        showAiPanel.set(false);
    }
</script>

<nav class="md:hidden fixed bottom-0 left-0 right-0 h-14 bg-white border-t border-slate-200 flex justify-around items-center z-40" style="padding-bottom: env(safe-area-inset-bottom);">
    <button on:click={() => switchView('dashboard')} class="flex-1 flex flex-col items-center justify-center h-full gap-0.5"
        class:text-blue-600={$currentView === 'dashboard'}
        class:text-slate-400={$currentView !== 'dashboard'}>
        <i class="ph ph-sun text-2xl"></i>
        <span class="text-[10px] font-semibold">看板</span>
    </button>
    <button on:click={() => switchView('templates')} class="flex-1 flex flex-col items-center justify-center h-full gap-0.5"
        class:text-purple-600={$currentView === 'templates'}
        class:text-slate-400={$currentView !== 'templates'}>
        <i class="ph ph-copy text-2xl"></i>
        <span class="text-[10px] font-semibold">模板</span>
    </button>
    <button on:click={() => switchView('scheduled')} class="flex-1 flex flex-col items-center justify-center h-full gap-0.5"
        class:text-teal-600={$currentView === 'scheduled'}
        class:text-slate-400={$currentView !== 'scheduled'}>
        <i class="ph ph-clock-countdown text-2xl"></i>
        <span class="text-[10px] font-semibold">定时</span>
    </button>
    <button on:click={() => switchView('statistics')} class="flex-1 flex flex-col items-center justify-center h-full gap-0.5"
        class:text-indigo-600={$currentView === 'statistics'}
        class:text-slate-400={$currentView !== 'statistics'}>
        <i class="ph ph-chart-bar text-2xl"></i>
        <span class="text-[10px] font-semibold">统计</span>
    </button>
    <button on:click={() => switchView('settings')} class="flex-1 flex flex-col items-center justify-center h-full gap-0.5"
        class:text-slate-600={$currentView === 'settings'}
        class:text-slate-400={$currentView !== 'settings'}>
        <i class="ph ph-gear text-2xl"></i>
        <span class="text-[10px] font-semibold">设置</span>
    </button>
</nav>