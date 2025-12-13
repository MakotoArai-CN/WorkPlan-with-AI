<script>
    import { taskStore, activeTask } from '../stores/tasks.js';

    let statsStart = new Date().toISOString().split('T')[0];
    let statsEnd = new Date().toISOString().split('T')[0];
    let statsStatus = 'all';
    let statsRangeType = 'week';

    $: statsData = (() => {
        let list = $taskStore.tasks.filter(t => {
            const d = t.date.split('T')[0];
            return d >= statsStart && d <= statsEnd;
        });

        if (statsStatus === 'incomplete') {
            list = list.filter(t => t.status === 'todo' || t.status === 'doing');
        } else if (statsStatus !== 'all') {
            list = list.filter(t => t.status === statsStatus);
        }

        list.sort((a, b) => new Date(b.date) - new Date(a.date));

        const total = list.length;
        const done = list.filter(t => t.status === 'done').length;
        const doing = list.filter(t => t.status === 'doing').length;
        const todo = list.filter(t => t.status === 'todo').length;
        const rate = total > 0 ? ((done / total) * 100).toFixed(1) : 0;

        return { total, done, doing, todo, rate, list };
    })();

    function setStatsRange(type) {
        statsRangeType = type;
        const d = new Date();
        const y = d.getFullYear();
        const m = d.getMonth();
        const day = d.getDay() || 7;

        if (type === 'today') {
            statsStart = statsEnd = new Date().toISOString().split('T')[0];
        } else if (type === 'yesterday') {
            d.setDate(d.getDate() - 1);
            statsStart = statsEnd = d.toISOString().split('T')[0];
        } else if (type === 'week') {
            d.setDate(d.getDate() - day + 1);
            statsStart = d.toISOString().split('T')[0];
            d.setDate(d.getDate() + 6);
            statsEnd = d.toISOString().split('T')[0];
        } else if (type === 'lastWeek') {
            d.setDate(d.getDate() - day - 6);
            statsStart = d.toISOString().split('T')[0];
            d.setDate(d.getDate() + 6);
            statsEnd = d.toISOString().split('T')[0];
        } else if (type === 'month') {
            statsStart = new Date(y, m, 1, 12).toISOString().split('T')[0];
            statsEnd = new Date(y, m + 1, 0, 12).toISOString().split('T')[0];
        } else if (type === 'lastMonth') {
            statsStart = new Date(y, m - 1, 1, 12).toISOString().split('T')[0];
            statsEnd = new Date(y, m, 0, 12).toISOString().split('T')[0];
        }
    }

    function formatDateTime(d) {
        return d ? d.replace('T', ' ') : '';
    }

    function isOverdue(t) {
        if (!t.deadline) return false;
        const now = new Date().toISOString().slice(0, 16);
        return t.deadline < now && t.status !== 'done';
    }

    function getStatusStyle(t) {
        if (t.status === 'done') {
            return t.deadline && t.completedDate > t.deadline
                ? 'bg-red-100 text-red-700'
                : 'bg-green-100 text-green-700';
        }
        if (t.status === 'doing') return 'bg-blue-100 text-blue-700';
        return 'bg-slate-100 text-slate-500';
    }

    function getStatusLabel(t) {
        if (t.status === 'done') {
            return t.deadline && t.completedDate > t.deadline ? '超时完成' : '已完成';
        }
        return { todo: '未开始', doing: '进行中' }[t.status];
    }

    function selectTask(task) {
        activeTask.set(task);
    }

    setStatsRange('week');
</script>

<header class="h-auto md:h-16 bg-white/90 backdrop-blur px-4 md:px-6 flex flex-col md:flex-row justify-between items-center z-10 sticky top-0 border-b border-slate-200 shrink-0 py-2 gap-2">
    <div>
        <h2 class="text-lg font-bold text-indigo-800">数据统计</h2>
    </div>
    <div class="flex flex-col md:flex-row items-center gap-2 w-full md:w-auto">
        <select bind:value={statsStatus}
            class="w-full md:w-auto text-xs border border-slate-200 rounded px-2 py-1.5 outline-none bg-white text-slate-600 font-bold">
            <option value="all">全部状态</option>
            <option value="done">已完成</option>
            <option value="incomplete">未完成 (未开始+进行中)</option>
            <option value="doing">进行中</option>
            <option value="todo">未开始</option>
        </select>
        <div class="h-4 w-px bg-slate-200 hidden md:block"></div>
        <div class="w-full md:w-auto flex bg-slate-100 p-1 rounded-lg gap-1 overflow-x-auto justify-center md:justify-start">
            {#each [
                { key: 'today', label: '今日' },
                { key: 'yesterday', label: '昨日' },
                { key: 'week', label: '本周' },
                { key: 'lastWeek', label: '上周' },
                { key: 'month', label: '本月' },
                { key: 'lastMonth', label: '上月' }
            ] as item}
                <button on:click={() => setStatsRange(item.key)}
                    class="px-2 py-1 text-[10px] rounded hover:bg-white hover:shadow-sm transition whitespace-nowrap"
                    class:bg-white={statsRangeType === item.key}
                    class:shadow-sm={statsRangeType === item.key}
                    class:font-bold={statsRangeType === item.key}
                    class:text-indigo-600={statsRangeType === item.key}
                    class:text-slate-500={statsRangeType !== item.key}>
                    {item.label}
                </button>
            {/each}
        </div>
        <div class="w-full md:w-auto flex items-center justify-center gap-1 bg-white border border-slate-200 rounded-md px-2 py-0.5">
            <input type="date" bind:value={statsStart} on:change={() => statsRangeType = 'custom'}
                class="text-[10px] outline-none text-slate-500 w-24 md:w-20 text-center">
            <span class="text-slate-300">-</span>
            <input type="date" bind:value={statsEnd} on:change={() => statsRangeType = 'custom'}
                class="text-[10px] outline-none text-slate-500 w-24 md:w-20 text-center">
        </div>
    </div>
</header>

<div class="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 pb-32 min-h-0">
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
            <div class="text-xs font-bold text-slate-400 uppercase mb-1">总任务</div>
            <div class="text-3xl font-black text-slate-700">{statsData.total}</div>
        </div>
        <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
            <div class="text-xs font-bold text-green-500 uppercase mb-1">已完成</div>
            <div class="text-3xl font-black text-green-600">
                {statsData.done}
                <span class="text-sm font-medium text-slate-400">({statsData.rate}%)</span>
            </div>
        </div>
        <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
            <div class="text-xs font-bold text-blue-500 uppercase mb-1">进行中</div>
            <div class="text-3xl font-black text-blue-600">{statsData.doing}</div>
        </div>
        <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
            <div class="text-xs font-bold text-gray-500 uppercase mb-1">未开始</div>
            <div class="text-3xl font-black text-gray-600">{statsData.todo}</div>
        </div>
    </div>

    <div class="md:hidden space-y-3">
        <div class="px-2 text-xs font-bold text-slate-400">任务明细 ({statsStart} ~ {statsEnd})</div>
        {#if statsData.list.length === 0}
            <div class="text-center py-8 text-slate-400 text-sm">暂无数据</div>
        {/if}
        {#each statsData.list as t (t.id)}
            <div on:click={() => selectTask(t)}
                class="bg-white p-3 rounded-xl shadow-sm border border-slate-100 flex flex-col gap-2 active:scale-[0.98] transition-transform cursor-pointer">
                <div class="flex justify-between items-start">
                    <div class="font-bold text-slate-800 text-sm truncate flex-1">{t.title}</div>
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ml-2 {getStatusStyle(t)}">
                        {getStatusLabel(t)}
                    </span>
                </div>
                <div class="flex justify-between items-center text-[10px] text-slate-400">
                    <div class="flex gap-2">
                        <span class:text-red-500={isOverdue(t)} class:font-bold={isOverdue(t)}>
                            截止: {formatDateTime(t.deadline) || '-'}
                        </span>
                    </div>
                    <div class="font-mono">
                        {#if t.completedDate}
                            <span class="text-green-600">完: {formatDateTime(t.completedDate).split(' ')[0]}</span>
                        {:else}
                            <span class="text-slate-300">未完成</span>
                        {/if}
                    </div>
                </div>
            </div>
        {/each}
    </div>

    <div class="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden hidden md:block">
        <div class="px-6 py-4 border-b border-slate-50 font-bold text-slate-700">
            任务明细 ({statsStart} ~ {statsEnd})
        </div>
        <table class="w-full text-sm text-left">
            <thead class="bg-slate-50 text-slate-500">
                <tr>
                    <th class="px-6 py-3">名称</th>
                    <th class="px-6 py-3">状态</th>
                    <th class="px-6 py-3">计划与截止</th>
                    <th class="px-6 py-3">开始与结束</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                {#each statsData.list as t (t.id)}
                    <tr on:click={() => selectTask(t)} class="hover:bg-slate-50 cursor-pointer">
                        <td class="px-6 py-3 font-bold text-slate-700">{t.title}</td>
                        <td class="px-6 py-3">
                            <span class="px-2 py-1 rounded text-xs font-bold {getStatusStyle(t)}">
                                {getStatusLabel(t)}
                            </span>
                        </td>
                        <td class="px-6 py-3 text-xs">
                            <div class="text-slate-600">{formatDateTime(t.date)}</div>
                            <div class:text-red-500={isOverdue(t)} class:text-slate-400={!isOverdue(t)}>
                                {formatDateTime(t.deadline) || '-'}
                            </div>
                        </td>
                        <td class="px-6 py-3 text-xs">
                            <div class="text-blue-600">{t.startTime ? formatDateTime(t.startTime) : '-'}</div>
                            <div class="text-green-600">{t.completedDate ? formatDateTime(t.completedDate) : '-'}</div>
                        </td>
                    </tr>
                {/each}
            </tbody>
        </table>
    </div>
</div>