<script>
    import { currentView } from '../stores/tasks.js';
    import { showAiPanel } from '../stores/ai.js';
    import { pushNavigation } from '../stores/navigation.js';
    
    function switchView(view) {
        currentView.set(view);
        showAiPanel.set(false);
        pushNavigation(view);
    }
</script>

<nav class="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex justify-around items-center z-40 safe-nav">
    <button on:click={() => switchView('dashboard')} 
        class="flex-1 flex flex-col items-center justify-center h-full gap-0.5 py-2"
        class:text-blue-600={$currentView === 'dashboard'}
        class:text-slate-400={$currentView !== 'dashboard'}>
        <i class="ph ph-sun text-2xl"></i>
        <span class="text-[10px] font-semibold">看板</span>
    </button>

    <button on:click={() => switchView('templates')} 
        class="flex-1 flex flex-col items-center justify-center h-full gap-0.5 py-2"
        class:text-purple-600={$currentView === 'templates'}
        class:text-slate-400={$currentView !== 'templates'}>
        <i class="ph ph-copy text-2xl"></i>
        <span class="text-[10px] font-semibold">模板</span>
    </button>

    <button on:click={() => switchView('scheduled')} 
        class="flex-1 flex flex-col items-center justify-center h-full gap-0.5 py-2"
        class:text-teal-600={$currentView === 'scheduled'}
        class:text-slate-400={$currentView !== 'scheduled'}>
        <i class="ph ph-clock-countdown text-2xl"></i>
        <span class="text-[10px] font-semibold">定时</span>
    </button>

    <button on:click={() => switchView('notes')} 
        class="flex-1 flex flex-col items-center justify-center h-full gap-0.5 py-2"
        class:text-emerald-600={$currentView === 'notes'}
        class:text-slate-400={$currentView !== 'notes'}>
        <i class="ph ph-notebook text-2xl"></i>
        <span class="text-[10px] font-semibold">笔记</span>
    </button>

    <button on:click={() => switchView('more')} 
        class="flex-1 flex flex-col items-center justify-center h-full gap-0.5 py-2"
        class:text-slate-600={$currentView === 'more' || $currentView === 'aichat' || $currentView === 'passwords' || $currentView === 'statistics' || $currentView === 'settings'}
        class:text-slate-400={$currentView !== 'more' && $currentView !== 'aichat' && $currentView !== 'passwords' && $currentView !== 'statistics' && $currentView !== 'settings'}>
        <i class="ph ph-dots-three text-2xl"></i>
        <span class="text-[10px] font-semibold">更多</span>
    </button>
</nav>

<style>
    .safe-nav {
        padding-bottom: env(safe-area-inset-bottom);
        height: calc(3.5rem + env(safe-area-inset-bottom));
    }
</style>