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
        getAiProviderInfo,
        switchProvider,
        hydrateCurrentProviderConfigWithDefaults,
    } from "../stores/ai.js";
    import { settingsStore } from "../stores/settings.js";
    import { showAlert } from "../stores/modal.js";
    import { onMount } from "svelte";
    import { _ } from 'svelte-i18n';
    import { get } from 'svelte/store';

    function t(key, opts) { return get(_)(key, opts); }

    let testing = false;
    let providers = [];
    let currentModels = [];
    let currentProvider = null;
    let activeTab = "basic";
    let dailyPrompt = "";
    let weeklyPrompt = "";

    const defaultDailyPrompt = t('ai_settings_page.default_daily_prompt');

    const defaultWeeklyPrompt = t('ai_settings_page.default_weekly_prompt');

    async function loadCurrentProviderInfo() {
        currentProvider = await getAiProviderInfo($aiConfig.provider);
    }

    async function loadCurrentProviderModels() {
        const providerId = $aiConfig.provider;
        if (providerId === "custom") {
            currentModels = [];
            return;
        }
        const apiKey = $aiConfig.apiKey || "";
        const models = await loadModelsForProvider(providerId, apiKey);
        currentModels = models || [];

        if (currentModels.length > 0) {
            const savedModel = $aiConfig.model;
            if (
                !savedModel ||
                savedModel === "auto" ||
                !currentModels.includes(savedModel)
            ) {
                updateAiConfig({ model: currentModels[0] });
            }
        }
    }

    onMount(async () => {
        providers = await getAiProviders();
        await hydrateCurrentProviderConfigWithDefaults();
        await loadCurrentProviderInfo();
        await loadCurrentProviderModels();
        dailyPrompt = $settingsStore.dailyReportPrompt || "";
        weeklyPrompt = $settingsStore.weeklyReportPrompt || "";
    });

    $: if ($showAiSettings) {
        (async () => {
            await hydrateCurrentProviderConfigWithDefaults();
            await loadCurrentProviderInfo();
            await loadCurrentProviderModels();
        })();
    }

    async function handleTestConnection() {
        const t = get(_);
        testing = true;
        try {
            const result = await testAiConnection();
            if (result.success) {
                await showAlert({
                    title: t('ai_settings_page.ok'),
                    message: result.response,
                    variant: "success",
                });
            } else {
                await showAlert({
                    title: t('ai_settings_page.fail'),
                    message: result.message,
                    variant: "danger",
                });
            }
        } catch (error) {
            await showAlert({
                title: t('common.error'),
                message: error.message,
                variant: "danger",
            });
        } finally {
            testing = false;
        }
    }

    async function handleSave() {
        const t = get(_);
        saveAiConfig();
        settingsStore.setDailyReportPrompt(dailyPrompt);
        settingsStore.setWeeklyReportPrompt(weeklyPrompt);
        updateAiConfig({
            dailyReportPrompt: dailyPrompt,
            weeklyReportPrompt: weeklyPrompt,
        });
        showAiSettings.set(false);
        await showAlert({
            title: t('ai_settings_page.save_ok'),
            message: t('ai_settings_page.save_msg'),
            variant: "success",
        });
    }

    function handleClose() {
        saveAiConfig();
        showAiSettings.set(false);
    }

    async function handleProviderChange(e) {
        const providerId = e.target.value;
        await switchProvider(providerId);
        await loadCurrentProviderInfo();
        await loadCurrentProviderModels();
    }

    async function handleApiKeyChange() {
        if (
            $aiConfig.provider !== "custom" &&
            currentProvider?.supportsModelList &&
            $aiConfig.apiKey
        ) {
            await loadCurrentProviderModels();
        }
    }

    async function handleRefreshModels() {
        await loadCurrentProviderModels();
    }

    function openApiUrl(url) {
        if (!url) return;
        window.open(url, "_blank");
    }

    function resetDailyPrompt() {
        dailyPrompt = defaultDailyPrompt;
    }

    function resetWeeklyPrompt() {
        weeklyPrompt = defaultWeeklyPrompt;
    }

    $: isCustomProvider = $aiConfig.provider === "custom";
    $: needsApiKey = (() => {
        if (
            $aiConfig.provider === "ollama" ||
            $aiConfig.provider === "lmstudio"
        )
            return false;
        if (isCustomProvider) return false; // custom provider doesn't require key
        return currentProvider && currentProvider.authType !== "none";
    })();
    $: displayModels = isCustomProvider
        ? []
        : $providerModels[$aiConfig.provider] ||
          currentModels ||
          currentProvider?.defaultModels ||
          [];
</script>

{#if $showAiSettings}
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
            on:click={handleClose}
            on:keydown={handleClose}
            role="button"
            tabindex="0"
            class="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        ></div>
        <div
            class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl relative flex flex-col max-h-[90vh] overflow-hidden"
        >
            <div
                class="px-4 md:px-6 py-3 md:py-4 border-b border-slate-100 flex justify-between items-center bg-rose-50"
            >
                <h3
                    class="font-bold text-base md:text-lg text-rose-700 flex items-center gap-2"
                >
                    <i class="ph-fill ph-sparkle"></i> {$_('ai_settings_page.title')}
                </h3>
                <button
                    on:click={handleClose}
                    class="text-slate-500 hover:text-slate-700"
                >
                    <i class="ph ph-x text-xl"></i>
                </button>
            </div>

            <div
                class="flex border-b border-slate-100 bg-white shrink-0 overflow-x-auto"
            >
                <button
                    on:click={() => (activeTab = "basic")}
                    class="px-4 md:px-6 py-2.5 md:py-3 text-xs md:text-sm font-bold border-b-2 transition whitespace-nowrap"
                    class:border-rose-500={activeTab === "basic"}
                    class:text-rose-600={activeTab === "basic"}
                    class:border-transparent={activeTab !== "basic"}
                    class:text-slate-500={activeTab !== "basic"}
                >
                    {$_('ai_settings_page.tab_basic')}
                </button>
                <button
                    on:click={() => (activeTab = "advanced")}
                    class="px-4 md:px-6 py-2.5 md:py-3 text-xs md:text-sm font-bold border-b-2 transition whitespace-nowrap"
                    class:border-rose-500={activeTab === "advanced"}
                    class:text-rose-600={activeTab === "advanced"}
                    class:border-transparent={activeTab !== "advanced"}
                    class:text-slate-500={activeTab !== "advanced"}
                >
                    {$_('ai_settings_page.tab_advanced')}
                </button>
                <button
                    on:click={() => (activeTab = "prompts")}
                    class="px-4 md:px-6 py-2.5 md:py-3 text-xs md:text-sm font-bold border-b-2 transition whitespace-nowrap"
                    class:border-rose-500={activeTab === "prompts"}
                    class:text-rose-600={activeTab === "prompts"}
                    class:border-transparent={activeTab !== "prompts"}
                    class:text-slate-500={activeTab !== "prompts"}
                >
                    {$_('ai_settings_page.tab_prompts')}
                </button>
            </div>

            <div
                class="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 md:space-y-6"
            >
                {#if activeTab === "basic"}
                    <div>
                        <label
                            class="text-xs font-bold text-slate-500 uppercase mb-2 block"
                            >{$_('ai_settings_page.provider')}</label
                        >
                        <select
                            value={$aiConfig.provider}
                            on:change={handleProviderChange}
                            class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-rose-400"
                        >
                            <optgroup label={$_('ai_settings_page.group_international')}>
                                {#each providers.filter((p) => ["openai", "anthropic", "google", "mistral", "cohere", "perplexity", "together", "fireworks", "openrouter", "groq", "huggingface", "novita", "cloudflare"].includes(p.id)) as provider}
                                    <option value={provider.id}
                                        >{provider.name}</option
                                    >
                                {/each}
                            </optgroup>
                            <optgroup label={$_('ai_settings_page.group_domestic')}>
                                {#each providers.filter( (p) => ["deepseek", "zhipu", "qwen", "moonshot", "spark", "baidu", "hunyuan", "yi", "baichuan", "minimax", "stepfun", "doubao", "sensetime", "siliconflow", "mimo"].includes(p.id), ) as provider}
                                    <option value={provider.id}
                                        >{provider.name}</option
                                    >
                                {/each}
                            </optgroup>
                            <optgroup label={$_('ai_settings_page.group_local')}>
                                {#each providers.filter( (p) => ["ollama", "lmstudio", "custom"].includes(p.id), ) as provider}
                                    <option value={provider.id}
                                        >{provider.name}</option
                                    >
                                {/each}
                            </optgroup>
                        </select>
                        <div class="flex items-center gap-3 mt-2 flex-wrap">
                            {#if currentProvider?.docUrl}
                                <a
                                    href={currentProvider.docUrl}
                                    target="_blank"
                                    class="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1"
                                >
                                    <i class="ph ph-book-open"></i> {$_('ai_settings_page.docs')}
                                </a>
                            {/if}
                            {#if currentProvider?.apiUrl}
                                <button
                                    on:click={() =>
                                        openApiUrl(currentProvider.apiUrl)}
                                    class="text-xs text-green-600 hover:text-green-700 flex items-center gap-1 font-bold"
                                >
                                    <i class="ph ph-key"></i> {$_('ai_settings_page.get_key')}
                                </button>
                            {/if}
                        </div>
                    </div>

                    {#if isCustomProvider}
                        <div>
                            <label
                                class="text-xs font-bold text-slate-500 uppercase mb-2 block"
                                >{$_('ai_settings_page.custom_endpoint')}</label
                            >
                            <input
                                bind:value={$aiConfig.customEndpoint}
                                type="url"
                                placeholder="https://api.example.com/v1/chat/completions"
                                class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-rose-400 font-mono"
                            />
                            <div class="text-[10px] text-slate-400 mt-1">
                                {$_('ai_settings_page.custom_endpoint_hint')}
                            </div>
                        </div>
                        <div>
                            <label
                                class="text-xs font-bold text-slate-500 uppercase mb-2 block"
                                >{$_('ai_settings_page.custom_model')}</label
                            >
                            <input
                                bind:value={$aiConfig.customModel}
                                type="text"
                                placeholder={$_('ai_settings_page.custom_model_ph')}
                                class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-rose-400 font-mono"
                            />
                        </div>
                    {:else if $aiConfig.provider === "ollama" || $aiConfig.provider === "lmstudio"}
                        <div>
                            <label
                                class="text-xs font-bold text-slate-500 uppercase mb-2 block"
                            >
                                {$_('ai_settings_page.local_addr')}
                                <span class="text-rose-400">{$_('ai_settings_page.local_addr_custom')}</span>
                            </label>
                            <input
                                bind:value={$aiConfig.customEndpoint}
                                type="url"
                                placeholder={$aiConfig.provider === "ollama"
                                    ? "http://localhost:11434/api/chat"
                                    : "http://localhost:1234/v1/chat/completions"}
                                class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-rose-400 font-mono"
                            />
                            <div class="text-[10px] text-slate-400 mt-1">
                                {#if $aiConfig.provider === "ollama"}
                                    {$_('ai_settings_page.local_hint_ollama')}
                                {:else}
                                    {$_('ai_settings_page.local_hint_lmstudio')}
                                {/if}
                            </div>
                        </div>
                    {:else if displayModels.length > 0}
                        <div>
                            <div class="flex items-center justify-between mb-2">
                                <label
                                    class="text-xs font-bold text-slate-500 uppercase"
                                    >{$_('ai_settings_page.model')}</label
                                >
                                {#if currentProvider?.supportsModelList}
                                    <button
                                        on:click={handleRefreshModels}
                                        disabled={$modelsLoading}
                                        class="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1"
                                    >
                                        <i
                                            class="ph ph-arrows-clockwise"
                                            class:animate-spin={$modelsLoading}
                                        ></i>
                                        {$modelsLoading ? $_('ai_settings_page.loading') : $_('ai_settings_page.refresh')}
                                    </button>
                                {/if}
                            </div>
                            <select
                                bind:value={$aiConfig.model}
                                class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-rose-400"
                            >
                                {#each displayModels as model}
                                    <option value={model}>{model}</option>
                                {/each}
                            </select>
                            <div class="text-[10px] text-slate-400 mt-1">
                                {$_('ai_settings_page.models_count', { values: { count: displayModels.length } })}
                            </div>
                        </div>
                    {/if}

                    {#if needsApiKey}
                        <div>
                            <label
                                class="text-xs font-bold text-slate-500 uppercase mb-2 block"
                                >API Key</label
                            >
                            <input
                                bind:value={$aiConfig.apiKey}
                                on:blur={handleApiKeyChange}
                                type="password"
                                placeholder={$_('ai_settings_page.api_key_ph')}
                                class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-rose-400 font-mono"
                            />
                        </div>
                    {/if}

                    {#if currentProvider?.authType === "baidu_token"}
                        <div>
                            <label
                                class="text-xs font-bold text-slate-500 uppercase mb-2 block"
                                >Secret Key</label
                            >
                            <input
                                bind:value={$aiConfig.secretKey}
                                type="password"
                                placeholder={$_('ai_settings_page.secret_key_ph')}
                                class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-rose-400 font-mono"
                            />
                        </div>
                    {/if}

                    {#if $aiConfig.provider === "cloudflare"}
                        <div>
                            <label
                                class="text-xs font-bold text-slate-500 uppercase mb-2 block"
                                >Account ID</label
                            >
                            <input
                                bind:value={$aiConfig.accountId}
                                type="text"
                                placeholder="Cloudflare Account ID"
                                class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-rose-400 font-mono"
                            />
                        </div>
                    {/if}

                    <div
                        class="bg-slate-50 rounded-lg p-3 md:p-4 flex items-center justify-between flex-wrap gap-2"
                    >
                        <span class="text-xs md:text-sm text-slate-600"
                            >{$_('ai_settings_page.test')}</span
                        >
                        <button
                            on:click={handleTestConnection}
                            disabled={testing}
                            class="px-3 md:px-4 py-1.5 md:py-2 bg-rose-600 text-white rounded-lg text-xs md:text-sm font-bold hover:bg-rose-700 disabled:opacity-50 flex items-center gap-2"
                        >
                            {#if testing}
                                <i class="ph ph-spinner animate-spin"></i>
                            {:else}
                                <i class="ph ph-plug"></i>
                            {/if}
                            {testing ? $_('ai_settings_page.testing') : $_('ai_settings_page.test')}
                        </button>
                    </div>
                {:else if activeTab === "advanced"}
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="text-xs text-slate-500 mb-1 block"
                                >Temperature</label
                            >
                            <input
                                bind:value={$aiConfig.temperature}
                                type="number"
                                min="0"
                                max="2"
                                step="0.1"
                                class="w-full border border-slate-200 rounded px-2 py-1.5 text-sm"
                            />
                            <div class="text-[10px] text-slate-400 mt-1">
                                {$_('ai_settings_page.rand_hint')}
                            </div>
                        </div>
                        <div>
                            <label class="text-xs text-slate-500 mb-1 block"
                                >Max Tokens</label
                            >
                            <input
                                bind:value={$aiConfig.maxTokens}
                                type="number"
                                min="100"
                                max="8192"
                                class="w-full border border-slate-200 rounded px-2 py-1.5 text-sm"
                            />
                            <div class="text-[10px] text-slate-400 mt-1">
                                {$_('ai_settings_page.max_tokens')}
                            </div>
                        </div>
                    </div>
                {:else if activeTab === "prompts"}
                    <div class="space-y-4">
                        <div
                            class="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800"
                        >
                            <div class="font-bold mb-1">{$_('ai_settings_page.vars_hint')}</div>
                            <code class="bg-amber-100 px-1 rounded font-bold text-amber-900">{'{'}{'{'}{"time"}{'}'}{'}'}</code>
                            <code class="bg-amber-100 px-1 rounded font-bold text-amber-900 ml-1">{'{'}{'{'}{"tasks"}{'}'}{'}'}</code>
                            <code class="bg-amber-100 px-1 rounded font-bold text-amber-900 ml-1">{'{'}{'{'}{"type"}{'}'}{'}' }</code>
                        </div>
                        <div>
                            <div class="flex items-center justify-between mb-2">
                                <label
                                    class="text-xs font-bold text-slate-500 uppercase"
                                    >{$_('ai_settings_page.daily_prompt')}</label
                                >
                                <button
                                    on:click={resetDailyPrompt}
                                    class="text-xs text-blue-500 hover:text-blue-700"
                                >
                                    {$_('ai_settings_page.use_default')}
                                </button>
                            </div>
                            <textarea
                                bind:value={dailyPrompt}
                                rows="6"
                                placeholder={$_('ai_settings_page.prompt_ph')}
                                class="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-rose-400 font-mono resize-none"
                            ></textarea>
                        </div>
                        <div>
                            <div class="flex items-center justify-between mb-2">
                                <label
                                    class="text-xs font-bold text-slate-500 uppercase"
                                    >{$_('ai_settings_page.weekly_prompt')}</label
                                >
                                <button
                                    on:click={resetWeeklyPrompt}
                                    class="text-xs text-blue-500 hover:text-blue-700"
                                >
                                    {$_('ai_settings_page.use_default')}
                                </button>
                            </div>
                            <textarea
                                bind:value={weeklyPrompt}
                                rows="6"
                                placeholder={$_('ai_settings_page.prompt_ph')}
                                class="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-rose-400 font-mono resize-none"
                            ></textarea>
                        </div>
                    </div>
                {/if}
            </div>

            <div
                class="p-3 md:p-4 border-t border-slate-100 flex justify-end gap-2 md:gap-3 bg-white shrink-0"
            >
                <button
                    on:click={handleClose}
                    class="px-3 md:px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-xs md:text-sm"
                    >{$_('ai_settings_page.cancel')}</button
                >
                <button
                    on:click={handleSave}
                    class="px-4 md:px-6 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 text-xs md:text-sm font-bold shadow"
                    >{$_('ai_settings_page.save')}</button
                >
            </div>
        </div>
    </div>
{/if}
