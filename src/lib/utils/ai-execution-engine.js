import { searchWeb, fetchWebContent } from './web-search.js';
import { readSelectedTextFiles } from './local-file-tools.js';
import { generateImage } from './ai-media-generation.js';

let _cancelledPlans = new Set();

export function cancelPlan(planId) {
    _cancelledPlans.add(planId);
}

function isPlanCancelled(planId) {
    return _cancelledPlans.has(planId);
}

function cleanupPlan(planId) {
    _cancelledPlans.delete(planId);
}

function generatePlanId() {
    return `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function decomposeIntoSteps(userMessage, config) {
    const { callAI } = await import('./ai-providers.js');

    const systemPrompt = `你是一个任务分解引擎。用户会给你一个复杂请求，你需要将它精确拆解为可执行的步骤。

## 可用步骤类型

每个步骤的 type 必须是以下之一（不要发明新类型）：
- "web_search": 搜索网络获取信息（params: { query: "搜索词" }）
- "web_fetch": 访问特定网页 URL（params: { url: "https://..." }）
- "file_read": 读取本地文件（params: { paths: ["/abs/path"] }）
- "content_generation": 让 AI 生成文本（params: { prompt: "...", context_from_steps?: [0,1] }）
- "image_generation": 生成图片（params: { prompt: "图片描述" }）
- "summarize": 汇总前面步骤结果（params: { focus?: "总结要点" }）
- "task_create": 仅当用户明确要求"创建任务/添加任务/记录待办"时使用（params: { title, priority?: "high|normal|low", note? }）

## 关键规则

1. **不要过度拆解**：单一明确请求只用 1 步即可
2. **task_create 仅用于明确的任务管理需求**——不要为"提醒/记得"自动创建任务
3. **依赖管理**：后续步骤通过 context_from_steps（数组，元素为前面步骤索引）引用结果
4. **顺序执行**：步骤必须按合理依赖顺序排列
5. **最大 6 步**：超过通常意味着拆解过细
6. **必须有最终输出步骤**：链式步骤的最后一步通常是 summarize 或 content_generation
7. **不确定时倾向于少步骤**

## 输出格式

严格 JSON，无其他文字：
{
  "title": "简洁的计划标题",
  "steps": [
    { "title": "步骤简述", "type": "step_type", "params": { ... } }
  ]
}`;

    const response = await callAI(config, userMessage, systemPrompt);

    try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON found');
        const parsed = JSON.parse(jsonMatch[0]);

        if (!parsed.steps || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
            throw new Error('Invalid plan structure');
        }

        const planId = generatePlanId();
        return {
            id: planId,
            title: parsed.title || '执行计划',
            steps: parsed.steps.map((step, i) => ({
                id: `${planId}_step_${i}`,
                index: i,
                title: step.title || `步骤 ${i + 1}`,
                type: step.type || 'content_generation',
                status: 'pending',
                params: step.params || {},
                result: null,
                error: null
            })),
            status: 'pending',
            createdAt: Date.now()
        };
    } catch (e) {
        return {
            id: generatePlanId(),
            title: '执行计划',
            steps: [{
                id: `fallback_0`,
                index: 0,
                title: '处理请求',
                type: 'content_generation',
                status: 'pending',
                params: { prompt: userMessage },
                result: null,
                error: null
            }],
            status: 'pending',
            createdAt: Date.now()
        };
    }
}

async function executeStep(step, previousResults, config, userMessage) {
    const { callAI } = await import('./ai-providers.js');

    const gatherContext = () => {
        const contextSteps = step.params.context_from_steps || [];
        return contextSteps
            .map(idx => previousResults[idx])
            .filter(Boolean)
            .map((r, i) => `[步骤${i + 1}结果]: ${typeof r === 'string' ? r : JSON.stringify(r).slice(0, 2000)}`)
            .join('\n\n');
    };

    switch (step.type) {
        case 'web_search': {
            const query = step.params.query || userMessage;
            const results = await searchWeb({ query, maxResults: step.params.maxResults || 6 });
            const entries = Array.isArray(results) ? results : [];
            let contentSummary = entries.map(e => `${e.title}: ${e.snippet || ''}`).join('\n');

            if (entries.length > 0 && entries[0]?.url) {
                const topContent = await fetchWebContent(entries[0].url, 3000).catch(() => null);
                if (topContent) {
                    contentSummary += `\n\n[详细内容]:\n${topContent}`;
                }
            }

            return {
                type: 'web_search',
                query,
                entries,
                summary: contentSummary.slice(0, 4000)
            };
        }

        case 'web_fetch': {
            const url = step.params.url;
            if (!url) throw new Error('缺少 URL 参数');
            const content = await fetchWebContent(url, 5000);
            return {
                type: 'web_fetch',
                url,
                content: content || '无法获取网页内容'
            };
        }

        case 'file_read': {
            const paths = step.params.paths || [];
            if (paths.length === 0) throw new Error('缺少文件路径');
            const files = await readSelectedTextFiles({ paths, maxBytes: 64000 });
            return {
                type: 'file_read',
                files: files.map(f => ({ name: f.name || f.path, content: f.content?.slice(0, 4000) || '' }))
            };
        }

        case 'content_generation': {
            const context = gatherContext();
            const prompt = step.params.prompt || userMessage;
            const fullPrompt = context
                ? `基于以下信息：\n${context}\n\n用户请求：${prompt}`
                : prompt;
            const response = await callAI(config, fullPrompt, '你是一个专业的内容生成助手。根据提供的信息和用户请求，生成高质量的内容。');
            return {
                type: 'content_generation',
                content: response || ''
            };
        }

        case 'image_generation': {
            const prompt = step.params.prompt || '';
            const result = await generateImage({
                provider: config.provider,
                apiKey: config.apiKey,
                prompt,
                model: step.params.model,
                customEndpoint: config.customEndpoint
            });
            return {
                type: 'image_generation',
                ...result
            };
        }

        case 'summarize': {
            const allResults = Object.entries(previousResults)
                .map(([idx, r]) => `[步骤${Number(idx) + 1}]: ${typeof r === 'string' ? r : JSON.stringify(r).slice(0, 2000)}`)
                .join('\n\n');
            const focus = step.params.focus || '综合所有信息，给出清晰的总结';
            const response = await callAI(
                config,
                `请根据以下执行结果进行总结：\n\n${allResults}\n\n总结要求：${focus}\n\n原始请求：${userMessage}`,
                '你是一个专业的总结助手。请根据提供的多步骤执行结果，生成简洁、有条理的总结。'
            );
            return {
                type: 'summarize',
                content: response || ''
            };
        }

        case 'task_create': {
            return {
                type: 'task_create',
                task: {
                    title: step.params.title || '新任务',
                    priority: step.params.priority || 'medium',
                    note: step.params.note || '',
                    status: 'todo'
                }
            };
        }

        default:
            throw new Error(`未知的步骤类型: ${step.type}`);
    }
}

export async function executePlan(plan, callbacks = {}) {
    const { onStepStart, onStepComplete, onStepFail, onPlanComplete } = callbacks;
    const results = {};

    plan.status = 'running';

    for (let i = 0; i < plan.steps.length; i++) {
        if (isPlanCancelled(plan.id)) {
            for (let j = i; j < plan.steps.length; j++) {
                plan.steps[j].status = 'skipped';
            }
            plan.status = 'cancelled';
            break;
        }

        const step = plan.steps[i];
        step.status = 'running';
        if (onStepStart) onStepStart(step, i);

        try {
            const config = callbacks.getConfig ? callbacks.getConfig() : {};
            const result = await executeStep(step, results, config, callbacks.userMessage || '');
            step.result = result;
            step.status = 'done';
            results[i] = result;
            if (onStepComplete) onStepComplete(step, i, result);
        } catch (error) {
            step.error = error.message || String(error);
            step.status = 'failed';
            if (onStepFail) onStepFail(step, i, error);
        }
    }

    if (plan.status !== 'cancelled') {
        const hasFailures = plan.steps.some(s => s.status === 'failed');
        plan.status = hasFailures ? 'partial' : 'done';
    }

    cleanupPlan(plan.id);
    if (onPlanComplete) onPlanComplete(plan, results);

    return { plan, results };
}

export function shouldDecompose(text) {
    const lowerText = String(text).toLowerCase();

    const multiStepPatterns = [
        /先.+然后.+/,
        /第一.+第二/,
        /首先.+接着/,
        /搜索.+总结/,
        /搜索.+分析/,
        /查找.+整理/,
        /分析.+生成/,
        /读取.+总结/,
        /调研.+报告/,
        /收集.+汇总/,
        /并且.+同时/,
        /然后创建任务/,
        /然后添加到/,
        /first.+then/i,
        /search.+and.+summarize/i,
        /find.+and.+create/i,
        /analyze.+and.+generate/i,
        /research.+report/i,
    ];

    if (multiStepPatterns.some(p => p.test(lowerText))) return true;

    const keywords = [
        '调研', '研究一下', '深入分析', '全面分析',
        '写一份报告', '生成报告', '做个调查',
        '帮我整理', '帮我收集', '帮我汇总',
        'research', 'investigate', 'comprehensive analysis'
    ];

    return keywords.some(k => lowerText.includes(k));
}

export function formatPlanSummary(plan, results) {
    const parts = [];
    parts.push(`## ${plan.title}\n`);

    for (const step of plan.steps) {
        const icon = step.status === 'done' ? '✅'
            : step.status === 'failed' ? '❌'
            : step.status === 'skipped' ? '⏭️'
            : '⏳';
        parts.push(`${icon} **${step.title}**`);

        if (step.status === 'failed' && step.error) {
            parts.push(`   错误: ${step.error}`);
        }
    }

    const lastResult = Object.values(results).pop();
    if (lastResult?.type === 'summarize' && lastResult.content) {
        parts.push(`\n---\n\n${lastResult.content}`);
    } else if (lastResult?.type === 'content_generation' && lastResult.content) {
        parts.push(`\n---\n\n${lastResult.content}`);
    }

    return parts.join('\n');
}

export function getTaskCreateResults(plan) {
    return plan.steps
        .filter(s => s.type === 'task_create' && s.status === 'done' && s.result?.task)
        .map(s => s.result.task);
}
