<script>
    import { 
        aiConfig, 
        showAiSettings, 
        saveAiConfig, 
        updateAiConfig,
        testAiConnection,
        getAiProviders,
        loadModelsForProvider,
        modelsLoading,
        providerModels,
        getAiProviderInfo
    } from '../stores/ai.js';
    import { settingsStore } from '../stores/settings.js';
    import { showAlert } from '../stores/modal.js';
    import { onMount } from 'svelte';
    import { isG4FProvider } from '../utils/g4f-client.js';

    let testing = false;
    let providers = [];
    let currentModels = [];
    let currentProvider = null;
    let activeTab = 'basic';
    let dailyPrompt = '';
    let weeklyPrompt = '';

    const defaultDailyPrompt = `当前时间：{{time}}
请根据以下任务列表生成一份{{type}}。

【任务列表】
{{tasks}}

【要求】
1. 生成简洁专业的日报
2. 包含：工作概述、已完成事项、进行中事项、工作亮点/问题
3. 使用 Markdown 格式
4. 语言简练，突出重点`;

    const defaultWeeklyPrompt = `当前时间：{{time}}
请根据以下任务列表生成一份{{type}}。

【任务列表】
{{tasks}}

【要求】
1. 生成简洁专业的周报
2. 包含：本周概述、已完成事项、进行中事项、下周计划、问题与建议
3. 使用 Markdown 格式
4. 语言简练，突出重点`;

    onMount(async () => {
        providers = await getAiProviders();
        await loadCurrentProviderInfo();
        await loadCurrentProviderModels();
        dailyPrompt = $settingsStore.dailyReportPrompt || '';
        weeklyPrompt = $settingsStore.weeklyReportPrompt || '';
    });

    async function loadCurrentProviderInfo() {
        currentProvider = await getAiProviderInfo($aiConfig.provider);
    }

    async function loadCurrentProviderModels() {
        const providerId = $aiConfig.provider;
        const apiKey = $aiConfig.apiKey || '';
        currentModels = await loadModelsForProvider(providerId, apiKey);
        if (currentModels.length > 0 && !currentModels.includes($aiConfig.model)) {
            updateAiConfig({ model: currentModels[0] });
        }
    }

    async function handleTestConnection() {
        testing = true;
        try {
            const result = await testAiConnection();
            if (result.success) {
                await showAlert({ title: '连接成功', message: 'AI 响应：' + result.response, variant: 'success' });
            } else {
                await showAlert({ title: '连接失败', message: result.message, variant: 'danger' });
            }
        } catch (error) {
            await showAlert({ title: '测试出错', message: error.message, variant: 'danger' });
        } finally {
            testing = false;
        }
    }

    async function handleSave() {
        saveAiConfig();
        settingsStore.setDailyReportPrompt(dailyPrompt);
        settingsStore.setWeeklyReportPrompt(weeklyPrompt);
        updateAiConfig({
            dailyReportPrompt: dailyPrompt,
            weeklyReportPrompt: weeklyPrompt
        });
        showAiSettings.set(false);
        await showAlert({ title: '保存成功', message: 'AI 配置已保存', variant: 'success' });
    }

    function handleClose() {
        showAiSettings.set(false);
    }

    async function handleProviderChange(e) {
        const providerId = e.target.value;
        const provider = providers.find(p => p.id === providerId);
        updateAiConfig({
            provider: providerId,
            model: provider?.defaultModel || 'auto'
        });
        await loadCurrentProviderInfo();
        await loadCurrentProviderModels();
    }

    async function handleApiKeyChange() {
        if (currentProvider?.supportsModelList && $aiConfig.apiKey) {
            await loadCurrentProviderModels();
        }
    }

    async function handleRefreshModels() {
        await loadCurrentProviderModels();
    }

    function openApiUrl(url) {
        if (!url) return;
        window.open(url, '_blank');
    }

    function resetDailyPrompt() {
        dailyPrompt = defaultDailyPrompt;
    }

    function resetWeeklyPrompt() {
        weeklyPrompt = defaultWeeklyPrompt;
    }

    $: needsApiKey = currentProvider && currentProvider.authType !== 'none' && !isG4FProvider($aiConfig.provider);
    $: displayModels = $providerModels[$aiConfig.provider] || currentModels || currentProvider?.defaultModels || [];
</script>

{#if $showAiSettings}
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div on:click={handleClose} on:keydown={handleClose} role="button" tabindex="0" class="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"></div>
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl relative flex flex-col max-h-[90vh] overflow-hidden">
            <div class="px-4 md:px-6 py-3 md:py-4 border-b border-slate-100 flex justify-between items-center bg-rose-50">
                <h3 class="font-bold text-base md:text-lg text-rose-700 flex items-center gap-2">
                    <i class="ph-fill ph-sparkle"></i> AI 配置
                </h3>
                <button on:click={handleClose} class="text-slate-500 hover:text-slate-700">
                    <i class="ph ph-x text-xl"></i>
                </button>
            </div>

            <div class="flex border-b border-slate-100 bg-white shrink-0 overflow-x-auto">
                <button on:click={() => activeTab = 'basic'}
                    class="px-4 md:px-6 py-2.5 md:py-3 text-xs md:text-sm font-bold border-b-2 transition whitespace-nowrap"
                    class:border-rose-500={activeTab === 'basic'}
                    class:text-rose-600={activeTab === 'basic'}
                    class:border-transparent={activeTab !== 'basic'}
                    class:text-slate-500={activeTab !== 'basic'}>
                    基础设置
                </button>
                <button on:click={() => activeTab = 'advanced'}
                    class="px-4 md:px-6 py-2.5 md:py-3 text-xs md:text-sm font-bold border-b-2 transition whitespace-nowrap"
                    class:border-rose-500={activeTab === 'advanced'}
                    class:text-rose-600={activeTab === 'advanced'}
                    class:border-transparent={activeTab !== 'advanced'}
                    class:text-slate-500={activeTab !== 'advanced'}>
                    高级参数
                </button>
                <button on:click={() => activeTab = 'prompts'}
                    class="px-4 md:px-6 py-2.5 md:py-3 text-xs md:text-sm font-bold border-b-2 transition whitespace-nowrap"
                    class:border-rose-500={activeTab === 'prompts'}
                    class:text-rose-600={activeTab === 'prompts'}
                    class:border-transparent={activeTab !== 'prompts'}
                    class:text-slate-500={activeTab !== 'prompts'}>
                    提示词模板
                </button>
            </div>

            <div class="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 md:space-y-6">
                {#if activeTab === 'basic'}
                    <div>
                        <label class="text-xs font-bold text-slate-500 uppercase mb-2 block">AI 厂商</label>
                        <select value={$aiConfig.provider} on:change={handleProviderChange}
                            class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-rose-400">
                            <optgroup label="G4F 免费服务">
                                {#each providers.filter(p => p.id.startsWith('g4f')) as provider}
                                    <option value={provider.id}>{provider.name}</option>
                                {/each}
                            </optgroup>
                            <optgroup label="国际服务商">
                                {#each providers.filter(p => !p.id.startsWith('g4f') && ['openai', 'anthropic', 'google', 'mistral', 'cohere', 'perplexity', 'together', 'fireworks', 'openrouter', 'groq', 'huggingface', 'novita', 'cloudflare'].includes(p.id)) as provider}
                                    <option value={provider.id}>{provider.name}</option>
                                {/each}
                            </optgroup>
                            <optgroup label="国内服务商">
                                {#each providers.filter(p => ['deepseek', 'zhipu', 'qwen', 'moonshot', 'spark', 'baidu', 'hunyuan', 'yi', 'baichuan', 'minimax', 'stepfun', 'doubao', 'sensetime', 'siliconflow'].includes(p.id)) as provider}
                                    <option value={provider.id}>{provider.name}</option>
                                {/each}
                            </optgroup>
                            <optgroup label="本地部署">
                                {#each providers.filter(p => ['ollama', 'lmstudio', 'custom'].includes(p.id)) as provider}
                                    <option value={provider.id}>{provider.name}</option>
                                {/each}
                            </optgroup>
                        </select>
                        <div class="flex items-center gap-3 mt-2 flex-wrap">
                            {#if currentProvider?.docUrl}
                                <a href={currentProvider.docUrl} target="_blank"
                                    class="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1">
                                    <i class="ph ph-book-open"></i> 文档
                                </a>
                            {/if}
                            {#if currentProvider?.apiUrl}
                                <button on:click={() => openApiUrl(currentProvider.apiUrl)}
                                    class="text-xs text-green-600 hover:text-green-700 flex items-center gap-1 font-bold">
                                    <i class="ph ph-key"></i> 获取 Key
                                </button>
                            {/if}
                        </div>
                    </div>

                    {#if displayModels.length > 0}
                        <div>
                            <div class="flex items-center justify-between mb-2">
                                <label class="text-xs font-bold text-slate-500 uppercase">模型</label>
                                {#if currentProvider?.supportsModelList}
                                    <button on:click={handleRefreshModels} disabled={$modelsLoading}
                                        class="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1">
                                        <i class="ph ph-arrows-clockwise" class:animate-spin={$modelsLoading}></i>
                                        {$modelsLoading ? '加载中...' : '刷新'}
                                    </button>
                                {/if}
                            </div>
                            <select bind:value={$aiConfig.model}
                                class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-rose-400">
                                {#each displayModels as model}
                                    <option value={model}>{model}</option>
                                {/each}
                            </select>
                            <div class="text-[10px] text-slate-400 mt-1">
                                共 {displayModels.length} 个可用模型
                            </div>
                        </div>
                    {/if}

                    {#if needsApiKey}
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase mb-2 block">API Key</label>
                            <input bind:value={$aiConfig.apiKey} on:blur={handleApiKeyChange} type="password" placeholder="请输入 API Key"
                                class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-rose-400 font-mono">
                        </div>
                    {/if}

                    {#if currentProvider?.authType === 'baidu_token'}
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase mb-2 block">Secret Key</label>
                            <input bind:value={$aiConfig.secretKey} type="password" placeholder="请输入 Secret Key"
                                class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-rose-400 font-mono">
                        </div>
                    {/if}

                    {#if $aiConfig.provider === 'cloudflare'}
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase mb-2 block">Account ID</label>
                            <input bind:value={$aiConfig.accountId} type="text" placeholder="Cloudflare Account ID"
                                class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-rose-400 font-mono">
                        </div>
                    {/if}

                    {#if $aiConfig.provider === 'custom'}
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase mb-2 block">API 端点</label>
                            <input bind:value={$aiConfig.customEndpoint} type="url"
                                placeholder="https://api.example.com/v1/chat/completions"
                                class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-rose-400 font-mono">
                        </div>
                    {/if}

                    <div class="bg-slate-50 rounded-lg p-3 md:p-4 flex items-center justify-between flex-wrap gap-2">
                        <span class="text-xs md:text-sm text-slate-600">测试 AI 连接</span>
                        <button on:click={handleTestConnection} disabled={testing}
                            class="px-3 md:px-4 py-1.5 md:py-2 bg-rose-600 text-white rounded-lg text-xs md:text-sm font-bold hover:bg-rose-700 disabled:opacity-50 flex items-center gap-2">
                            {#if testing}
                                <i class="ph ph-spinner animate-spin"></i>
                            {:else}
                                <i class="ph ph-plug"></i>
                            {/if}
                            {testing ? '测试中...' : '测试'}
                        </button>
                    </div>

                {:else if activeTab === 'advanced'}
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="text-xs text-slate-500 mb-1 block">Temperature</label>
                            <input bind:value={$aiConfig.temperature} type="number" min="0" max="2" step="0.1"
                                class="w-full border border-slate-200 rounded px-2 py-1.5 text-sm">
                            <div class="text-[10px] text-slate-400 mt-1">控制回复的随机性 (0-2)</div>
                        </div>
                        <div>
                            <label class="text-xs text-slate-500 mb-1 block">Max Tokens</label>
                            <input bind:value={$aiConfig.maxTokens} type="number" min="100" max="8192"
                                class="w-full border border-slate-200 rounded px-2 py-1.5 text-sm">
                            <div class="text-[10px] text-slate-400 mt-1">最大输出长度</div>
                        </div>
                    </div>

                {:else if activeTab === 'prompts'}
                    <div class="space-y-4">
                        <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                            <div class="font-bold mb-1">可用变量：</div>
                            <code class="bg-amber-100 px-1 rounded">{'{{time}}'}</code> 当前时间 | 
                            <code class="bg-amber-100 px-1 rounded">{'{{tasks}}'}</code> 任务列表 | 
                            <code class="bg-amber-100 px-1 rounded">{'{{type}}'}</code> 报告类型
                        </div>

                        <div>
                            <div class="flex items-center justify-between mb-2">
                                <label class="text-xs font-bold text-slate-500 uppercase">日报提示词模板</label>
                                <button on:click={resetDailyPrompt} class="text-xs text-blue-500 hover:text-blue-700">
                                    使用默认模板
                                </button>
                            </div>
                            <textarea bind:value={dailyPrompt} rows="6" placeholder="留空则使用默认模板..."
                                class="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-rose-400 font-mono resize-none"></textarea>
                        </div>

                        <div>
                            <div class="flex items-center justify-between mb-2">
                                <label class="text-xs font-bold text-slate-500 uppercase">周报提示词模板</label>
                                <button on:click={resetWeeklyPrompt} class="text-xs text-blue-500 hover:text-blue-700">
                                    使用默认模板
                                </button>
                            </div>
                            <textarea bind:value={weeklyPrompt} rows="6" placeholder="留空则使用默认模板..."
                                class="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-rose-400 font-mono resize-none"></textarea>
                        </div>
                    </div>
                {/if}
            </div>

            <div class="p-3 md:p-4 border-t border-slate-100 flex justify-end gap-2 md:gap-3 bg-white shrink-0">
                <button on:click={handleClose}
                    class="px-3 md:px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-xs md:text-sm">取消</button>
                <button on:click={handleSave}
                    class="px-4 md:px-6 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 text-xs md:text-sm font-bold shadow">保存配置</button>
            </div>
        </div>
    </div>
{/if}