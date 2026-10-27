<script>
    import { _ } from 'svelte-i18n';
    import { get } from 'svelte/store';
    import { showToast } from '../stores/modal.js';
    import { getEffectiveConfig, providerRequiresApiKey } from '../stores/ai.js';
    import MarkdownRenderer from './MarkdownRenderer.svelte';

    export let show = false;
    export let onClose = () => {};
    export let stats = {};
    export let year = new Date().getFullYear();
    export let defaultSalary = 0;

    let mode = 'score';
    let city = '';
    let salary = defaultSalary;
    let result = '';
    let loading = false;
    let error = '';

    $: modeLabel = mode === 'annual'
        ? $_('career.mode_annual')
        : mode === 'encourage' ? $_('career.mode_encourage') : $_('career.mode_score');

    function buildPrompt() {
        const data = [
            `年份: ${year}`,
            `城市: ${city || '未填写'}`,
            `月薪: ${Number(salary) > 0 ? `¥${Number(salary)}` : '未填写'}`,
            `年度加班: ${stats.overtimeHours || 0} 小时`,
            `年度加班费估算: ¥${stats.overtimePay || 0}`,
            `年度请假: ${stats.leaveDays || 0} 天（其中年假 ${stats.annualLeaveDays || 0} 天）`,
            `任务总数: ${stats.taskTotal || 0}，已完成: ${stats.taskDone || 0}`,
            `定时任务: ${stats.scheduledCount || 0} 个`,
            `最近一个月加班: ${stats.lastMonthHours || 0} 小时`
        ].join('\n');

        const role = '你是一位懂中国职场、劳动法和职业发展的顾问。你必须只基于给定数据分析，数据不足时明确说明，不要编造数字。语气直接、具体、有同理心，不人身攻击，不提供法律定论。';
        if (mode === 'annual') {
            return {
                system: role,
                user: `请根据以下记录写一份 ${year} 年度工作总结：\n${data}\n\n要求：\n1. 用 3-5 句话概括这一年的工作投入与节奏；\n2. 列出 3 个亮点和 2 个可改进点；\n3. 给出一句年度关键词；\n4. 最后给一段真诚的鼓励。用 Markdown 输出。`
            };
        }
        if (mode === 'encourage') {
            return {
                system: role,
                user: `以下是一位打工人的 ${year} 年记录：\n${data}\n\n请写一段 150 字以内的鼓励。要点：承认其付出、不要空洞鸡汤、给出一个明天就能做的小行动。用 Markdown 输出。`
            };
        }
        return {
            system: role,
            user: `请根据以下记录给这份工作打分并锐评：\n${data}\n\n输出结构：\n1. **综合评分：X/100**（一句话理由）；\n2. **四维评分**：工作强度、收入匹配度、生活平衡、成长性，各 0-25 分并说明；\n3. **锐评**：3-5 条，直接指出这份工作的性价比和风险，不要客套；\n4. **如果继续做**：2 条可执行建议；\n5. **如果考虑离开**：2 条判断信号；\n6. **年度总结**：3 句话；\n7. **给打工人的鼓励**：1-2 句。\n用 Markdown 输出。`
        };
    }

    async function analyze() {
        if (loading) return;
        const config = getEffectiveConfig();
        if (providerRequiresApiKey(config.provider) && !config.apiKey) {
            error = $_('career.ai_unavailable');
            return;
        }
        loading = true;
        error = '';
        result = '';
        try {
            const { callAI } = await import('../utils/ai-providers.js');
            const prompt = buildPrompt();
            const response = await callAI(config, prompt.user, prompt.system);
            result = typeof response === 'string'
                ? response
                : response?.content || response?.text || JSON.stringify(response);
            if (!result) throw new Error($_('career.empty'));
        } catch (e) {
            error = e.message || String(e);
        } finally {
            loading = false;
        }
    }

    async function copyResult() {
        if (!result) return;
        try {
            await navigator.clipboard.writeText(result);
            showToast({ message: $_('career.copied'), type: 'success' });
        } catch {
            showToast({ message: $_('career.copy_failed'), type: 'error' });
        }
    }

    function reset() {
        result = '';
        error = '';
    }
</script>

{#if show}
    <div class="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div
            class="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            on:click={onClose}
            on:keydown={(event) => event.key === 'Escape' && onClose()}
            role="button"
            tabindex="0"
        ></div>
        <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl relative flex flex-col max-h-[92vh] overflow-hidden">
            <div class="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-slate-900 dark:to-slate-900">
                <div>
                    <h3 class="font-bold text-lg text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <i class="ph-fill ph-sparkle text-indigo-500"></i> {$_('career.title')}
                    </h3>
                    <div class="text-[10px] text-slate-500 mt-0.5">{$_('career.subtitle')}</div>
                </div>
                <button on:click={onClose} aria-label={$_('career.close')}><i class="ph ph-x text-xl"></i></button>
            </div>

            <div class="flex-1 overflow-y-auto p-6 space-y-5">
                <div class="grid grid-cols-3 gap-2">
                    {#each [
                        { key: 'score', label: $_('career.mode_score'), icon: 'ph-chart-line-up' },
                        { key: 'annual', label: $_('career.mode_annual'), icon: 'ph-calendar' },
                        { key: 'encourage', label: $_('career.mode_encourage'), icon: 'ph-heart' }
                    ] as item}
                        <button on:click={() => { mode = item.key; reset(); }}
                            class={`p-2.5 rounded-xl border text-[11px] font-bold flex items-center justify-center gap-1.5 ${
                                mode === item.key
                                    ? 'bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-900/30 dark:border-indigo-700 dark:text-indigo-300'
                                    : 'bg-white border-slate-200 text-slate-500 dark:bg-slate-800 dark:border-slate-700'
                            }`}>
                            <i class={`ph ${item.icon}`}></i> {item.label}
                        </button>
                    {/each}
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label class="flex flex-col gap-1">
                        <span class="text-[10px] font-bold text-slate-500">{$_('career.city')}</span>
                        <input bind:value={city} placeholder={$_('career.city_placeholder')}
                            class="border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-sm" />
                    </label>
                    <label class="flex flex-col gap-1">
                        <span class="text-[10px] font-bold text-slate-500">{$_('career.salary')}</span>
                        <input type="number" min="0" bind:value={salary}
                            class="border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-sm" />
                    </label>
                </div>

                <div class="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3 text-[10px] text-slate-500 leading-5">
                    <div class="font-bold text-slate-600 dark:text-slate-300 mb-1">{$_('career.data_title')}</div>
                    <div>{$_('career.data_summary', { values: {
                        hours: stats.overtimeHours || 0,
                        days: stats.leaveDays || 0,
                        tasks: stats.taskDone || 0,
                        total: stats.taskTotal || 0
                    } })}</div>
                    <div class="mt-1 text-amber-600">{$_('career.data_notice')}</div>
                </div>

                {#if error}
                    <div class="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg p-3">{error}</div>
                {/if}

                {#if result}
                    <div class="border border-slate-100 dark:border-slate-700 rounded-xl p-4">
                        <MarkdownRenderer content={result} />
                    </div>
                {/if}
            </div>

            <div class="px-6 py-4 border-t border-slate-100 dark:border-slate-700 flex gap-3">
                {#if result}
                    <button on:click={copyResult}
                        class="px-4 py-2.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 rounded-xl font-bold text-sm">
                        <i class="ph ph-copy"></i> {$_('career.copy')}
                    </button>
                {/if}
                <button on:click={onClose}
                    class="flex-1 py-2.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 rounded-xl font-bold text-sm">
                    {$_('career.close')}
                </button>
                <button on:click={analyze} disabled={loading}
                    class="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2">
                    {#if loading}
                        <i class="ph ph-spinner animate-spin"></i> {$_('career.analyzing')}
                    {:else}
                        <i class="ph ph-sparkle"></i> {$_('career.analyze')} · {modeLabel}
                    {/if}
                </button>
            </div>
        </div>
    </div>
{/if}
