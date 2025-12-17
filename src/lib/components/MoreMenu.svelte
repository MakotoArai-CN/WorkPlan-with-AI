<script>
    import { currentView } from '../stores/tasks.js';
    import { pushNavigation } from '../stores/navigation.js';
    
    function navigateTo(view) {
        currentView.set(view);
        pushNavigation(view);
    }
</script>

<div class="flex flex-col h-screen md:h-full overflow-hidden bg-slate-50">
    <header class="h-14 md:h-16 bg-white/90 backdrop-blur px-4 md:px-6 flex justify-between items-center z-10 sticky top-0 border-b border-slate-200 shrink-0">
        <div>
            <h2 class="text-base md:text-lg font-bold text-slate-800">更多功能</h2>
            <div class="text-[10px] md:text-xs text-slate-500">选择功能模块</div>
        </div>
    </header>

    <div class="flex-1 overflow-y-auto p-4 space-y-3">
        <button on:click={() => navigateTo('statistics')}
            class="w-full bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex items-center gap-4 hover:bg-slate-50 transition">
            <div class="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center">
                <i class="ph-fill ph-chart-bar text-2xl text-indigo-600"></i>
            </div>
            <div class="flex-1 text-left">
                <div class="font-bold text-slate-800">数据统计</div>
                <div class="text-xs text-slate-500">查看任务统计和甘特图</div>
            </div>
            <i class="ph-bold ph-caret-right text-slate-300"></i>
        </button>

        <button on:click={() => navigateTo('aichat')}
            class="w-full bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex items-center gap-4 hover:bg-slate-50 transition">
            <div class="w-12 h-12 bg-gradient-to-br from-indigo-100 to-purple-100 rounded-xl flex items-center justify-center">
                <i class="ph-fill ph-robot text-2xl text-indigo-600"></i>
            </div>
            <div class="flex-1 text-left">
                <div class="font-bold text-slate-800">AI Chat</div>
                <div class="text-xs text-slate-500">智能对话助手</div>
            </div>
            <i class="ph-bold ph-caret-right text-slate-300"></i>
        </button>

        <button on:click={() => navigateTo('passwords')}
            class="w-full bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex items-center gap-4 hover:bg-slate-50 transition">
            <div class="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center">
                <i class="ph-fill ph-key text-2xl text-amber-600"></i>
            </div>
            <div class="flex-1 text-left">
                <div class="font-bold text-slate-800">密码记录本</div>
                <div class="text-xs text-slate-500">加密管理密码</div>
            </div>
            <i class="ph-bold ph-caret-right text-slate-300"></i>
        </button>

        <button on:click={() => navigateTo('settings')}
            class="w-full bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex items-center gap-4 hover:bg-slate-50 transition">
            <div class="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center">
                <i class="ph-fill ph-gear text-2xl text-slate-600"></i>
            </div>
            <div class="flex-1 text-left">
                <div class="font-bold text-slate-800">系统设置</div>
                <div class="text-xs text-slate-500">应用配置与管理</div>
            </div>
            <i class="ph-bold ph-caret-right text-slate-300"></i>
        </button>
    </div>
</div>