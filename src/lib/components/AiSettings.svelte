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
    import { showAlert } from '../stores/modal.js';
    import { onMount } from 'svelte';
    import { isG4FProvider } from '../utils/g4f-client.js';

    let testing = false;
    let providers = [];
    let currentModels = [];
    let currentProvider = null;

    onMount(async () => {
        providers = await getAiProviders();
        await loadCurrentProviderInfo();
        await loadCurrentProviderModels();
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

    $: needsApiKey = currentProvider && currentProvider.authType !== 'none' && !isG4FProvider($aiConfig.provider);
    $: displayModels = $providerModels[$aiConfig.provider] || currentModels || currentProvider?.defaultModels || [];
</script>

{#if $showAiSettings}
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div on:click={handleClose} on:keydown={handleClose} role="button" tabindex="0" class="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"></div>
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl relative flex flex-col max-h-[90vh] overflow-hidden">
            <div class="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-rose-50">
                <h3 class="font-bold text-lg text-rose-700 flex items-center gap-2">
                    <i class="ph-fill ph-sparkle"></i> AI 配置
                </h3>
                <button on:click={handleClose} class="text-slate-500 hover:text-slate-700">
                    <i class="ph ph-x text-xl"></i>
                </button>
            </div>

            <div class="flex-1 overflow-y-auto p-6 space-y-6">
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
                    <div class="flex items-center gap-3 mt-2">
                        {#if currentProvider?.docUrl}
                            <a href={currentProvider.docUrl} target="_blank"
                                class="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1">
                                <i class="ph ph-book-open"></i> 查看文档
                            </a>
                        {/if}
                        {#if currentProvider?.apiUrl}
                            <button on:click={() => openApiUrl(currentProvider.apiUrl)}
                                class="text-xs text-green-600 hover:text-green-700 flex items-center gap-1 font-bold">
                                <i class="ph ph-key"></i> 获取 API Key
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
                                    {$modelsLoading ? '加载中...' : '刷新列表'}
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
                        <label class="text-xs font-bold text-slate-500 uppercase mb-2 block">
                            API Key
                            {#if currentProvider?.authType === 'baidu_token'}
                                <span class="text-rose-500">(百度使用 API Key)</span>
                            {/if}
                        </label>
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

                <div class="border-t pt-4">
                    <h4 class="text-sm font-bold text-slate-600 mb-3">高级设置</h4>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="text-xs text-slate-500 mb-1 block">Temperature</label>
                            <input bind:value={$aiConfig.temperature} type="number" min="0" max="2" step="0.1"
                                class="w-full border border-slate-200 rounded px-2 py-1 text-sm">
                        </div>
                        <div>
                            <label class="text-xs text-slate-500 mb-1 block">Max Tokens</label>
                            <input bind:value={$aiConfig.maxTokens} type="number" min="100" max="4096"
                                class="w-full border border-slate-200 rounded px-2 py-1 text-sm">
                        </div>
                    </div>
                </div>

                <div class="bg-slate-50 rounded-lg p-4 flex items-center justify-between">
                    <span class="text-sm text-slate-600">测试 AI 连接</span>
                    <button on:click={handleTestConnection} disabled={testing}
                        class="px-4 py-2 bg-rose-600 text-white rounded-lg text-sm font-bold hover:bg-rose-700 disabled:opacity-50 flex items-center gap-2">
                        {#if testing}
                            <i class="ph ph-spinner animate-spin"></i>
                        {:else}
                            <i class="ph ph-plug"></i>
                        {/if}
                        {testing ? '测试中...' : '测试连接'}
                    </button>
                </div>
            </div>

            <div class="p-4 border-t border-slate-100 flex justify-end gap-3 bg-white">
                <button on:click={handleClose}
                    class="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm">取消</button>
                <button on:click={handleSave}
                    class="px-6 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 text-sm font-bold shadow">保存配置</button>
            </div>
        </div>
    </div>
{/if}