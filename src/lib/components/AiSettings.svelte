<script>
    import { 
        aiConfig, 
        showAiSettings, 
        saveAiConfig, 
        updateAiConfig,
        testAiConnection, 
        aiProviders,
        getCurrentProvider 
    } from '../stores/ai.js';
    import { showAlert } from '../stores/modal.js';

    let testing = false;

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

    function handleProviderChange(e) {
        const providerId = e.target.value;
        const provider = aiProviders.find(p => p.id === providerId);
        updateAiConfig({
            provider: providerId,
            model: provider?.defaultModel || ''
        });
    }

    $: currentProvider = getCurrentProvider();
</script>

{#if $showAiSettings}
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div on:click={handleClose} class="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"></div>
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
                        {#each aiProviders as provider}
                            <option value={provider.id}>{provider.name}</option>
                        {/each}
                    </select>
                    {#if currentProvider?.docUrl}
                        <a href={currentProvider.docUrl} target="_blank"
                            class="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1 mt-2">
                            <i class="ph ph-link"></i> 查看文档
                        </a>
                    {/if}
                </div>

                {#if currentProvider && currentProvider.models.length > 0}
                    <div>
                        <label class="text-xs font-bold text-slate-500 uppercase mb-2 block">模型</label>
                        <select bind:value={$aiConfig.model}
                            class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-rose-400">
                            {#each currentProvider.models as model}
                                <option value={model}>{model}</option>
                            {/each}
                        </select>
                    </div>
                {/if}

                <div>
                    <label class="text-xs font-bold text-slate-500 uppercase mb-2 block">
                        API Key
                        {#if currentProvider?.authType === 'baidu_token'}
                            <span class="text-rose-500">(百度使用 API Key)</span>
                        {/if}
                    </label>
                    <input bind:value={$aiConfig.apiKey} type="password" placeholder="请输入 API Key"
                        class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-rose-400 font-mono">
                </div>

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