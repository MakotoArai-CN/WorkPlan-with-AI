<script>
    import {
        aiChatHistory,
        isAiLoading,
        showAiSettings,
        sendChatMessage,
        retryChatMessage,
        clearAiChatHistory
    } from '../stores/ai.js';
    import { showConfirm } from '../stores/modal.js';

    let inputText = '';
    let chatContainer;
    let chatStyle = 'default';

    const chatStyles = [
        { id: 'default', name: '默认', icon: 'ph-chat-circle', color: 'blue' },
        { id: 'fun', name: '有趣', icon: 'ph-smiley', color: 'yellow' },
        { id: 'professional', name: '专业', icon: 'ph-briefcase', color: 'slate' },
        { id: 'creative', name: '创意', icon: 'ph-lightbulb', color: 'purple' },
        { id: 'concise', name: '简洁', icon: 'ph-lightning', color: 'green' },
        { id: 'teacher', name: '老师', icon: 'ph-chalkboard-teacher', color: 'orange' }
    ];

    function scrollToBottom() {
        if (chatContainer) {
            setTimeout(() => {
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }, 50);
        }
    }

    async function handleSend() {
        if (!inputText.trim() || $isAiLoading) return;
        const text = inputText;
        inputText = '';
        try {
            await sendChatMessage(text, chatStyle);
            scrollToBottom();
        } catch (error) {
            console.error('Send failed:', error);
        }
    }

    async function handleRetry(index) {
        try {
            await retryChatMessage(index);
            scrollToBottom();
        } catch (error) {
            console.error('Retry failed:', error);
        }
    }

    async function handleClear() {
        const confirmed = await showConfirm({
            title: '清空对话',
            message: '确定要清空所有对话记录吗？',
            confirmText: '清空',
            cancelText: '取消',
            variant: 'warning'
        });
        if (confirmed) {
            clearAiChatHistory();
        }
    }

    function copyMessage(content) {
        if (navigator.clipboard && content) {
            navigator.clipboard.writeText(content);
        }
    }

    function getStyleColor(styleId) {
        const style = chatStyles.find(s => s.id === styleId);
        return style ? style.color : 'blue';
    }

    $: if ($aiChatHistory.length) scrollToBottom();
</script>

<div class="flex-1 flex flex-col bg-gradient-to-b from-slate-50 to-white min-h-0">
    <header class="h-16 bg-white/90 backdrop-blur px-4 md:px-6 flex justify-between items-center z-10 sticky top-0 border-b border-slate-200 shrink-0">
        <div class="flex items-center gap-3">
            <div class="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center text-white shadow-lg">
                <i class="ph-fill ph-robot text-xl"></i>
            </div>
            <div>
                <h2 class="text-lg font-bold text-slate-800">AI 聊天</h2>
                <div class="text-xs text-slate-500 hidden md:block">智能对话助手 · 支持上下文记忆</div>
            </div>
        </div>
        <div class="flex items-center gap-2">
            <button on:click={() => showAiSettings.set(true)}
                class="h-9 px-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-sm font-medium flex items-center gap-2 transition">
                <i class="ph ph-gear"></i>
                <span class="hidden md:inline">设置</span>
            </button>
            <button on:click={handleClear}
                class="h-9 px-3 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-sm font-medium flex items-center gap-2 transition">
                <i class="ph ph-trash"></i>
                <span class="hidden md:inline">清空</span>
            </button>
        </div>
    </header>

    <div class="px-4 py-3 bg-white border-b border-slate-100 overflow-x-auto shrink-0">
        <div class="flex gap-2 min-w-max">
            {#each chatStyles as style}
                <button on:click={() => chatStyle = style.id}
                    class="px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 transition-all whitespace-nowrap"
                    class:bg-indigo-100={chatStyle === style.id}
                    class:text-indigo-700={chatStyle === style.id}
                    class:border-indigo-200={chatStyle === style.id}
                    class:bg-slate-50={chatStyle !== style.id}
                    class:text-slate-600={chatStyle !== style.id}
                    class:hover:bg-slate-100={chatStyle !== style.id}>
                    <i class="ph {style.icon}"></i>
                    {style.name}
                </button>
            {/each}
        </div>
    </div>

    <div bind:this={chatContainer} class="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth min-h-0">
        {#if $aiChatHistory.length === 0}
            <div class="flex flex-col items-center justify-center h-full text-center py-12">
                <div class="w-20 h-20 bg-gradient-to-br from-indigo-100 to-purple-100 rounded-2xl flex items-center justify-center mb-4">
                    <i class="ph-fill ph-sparkle text-4xl text-indigo-500"></i>
                </div>
                <h3 class="text-lg font-bold text-slate-700 mb-2">开始对话</h3>
                <p class="text-sm text-slate-500 max-w-xs">
                    选择聊天风格，输入您的问题，AI 将为您解答
                </p>
                <div class="mt-6 grid grid-cols-2 gap-2 max-w-xs">
                    <button on:click={() => { inputText = '你好，介绍一下你自己'; handleSend(); }}
                        class="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs text-slate-600 transition">
                        👋 自我介绍
                    </button>
                    <button on:click={() => { inputText = '今天的天气怎么样？'; handleSend(); }}
                        class="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs text-slate-600 transition">
                        🌤️ 聊聊天气
                    </button>
                    <button on:click={() => { inputText = '给我讲个笑话'; handleSend(); }}
                        class="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs text-slate-600 transition">
                        😄 讲个笑话
                    </button>
                    <button on:click={() => { inputText = '帮我写一首诗'; handleSend(); }}
                        class="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs text-slate-600 transition">
                        ✨ 写首诗
                    </button>
                </div>
            </div>
        {:else}
            {#each $aiChatHistory as msg, index}
                <div class="flex gap-3" class:flex-row-reverse={msg.role === 'user'}>
                    {#if msg.role === 'user'}
                        <div class="w-9 h-9 rounded-xl shrink-0 flex items-center justify-center shadow-sm bg-blue-600 text-white">
                            <i class="ph-fill ph-user"></i>
                        </div>
                    {:else}
                        <div class="w-9 h-9 rounded-xl shrink-0 flex items-center justify-center shadow-sm bg-gradient-to-br from-indigo-500 to-purple-600 text-white">
                            <i class="ph-fill ph-robot"></i>
                        </div>
                    {/if}

                    <div class="max-w-[80%] group">
                        {#if msg.role === 'user'}
                            <div class="p-3 rounded-2xl text-sm shadow-sm bg-blue-600 text-white rounded-tr-none">
                                <div class="whitespace-pre-wrap break-words leading-relaxed">{msg.content}</div>
                            </div>
                        {:else if msg.type === 'text'}
                            <div class="p-3 rounded-2xl text-sm shadow-sm bg-white border border-slate-200 text-slate-700 rounded-tl-none">
                                <div class="whitespace-pre-wrap break-words leading-relaxed">{msg.content}</div>
                            </div>
                            <div class="mt-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button on:click={() => copyMessage(msg.content)}
                                    class="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition"
                                    title="复制">
                                    <i class="ph ph-copy text-sm"></i>
                                </button>
                            </div>
                        {:else if msg.type === 'streaming'}
                            <div class="p-3 rounded-2xl text-sm shadow-sm bg-white border border-slate-200 text-slate-700 rounded-tl-none relative overflow-hidden">
                                <div class="whitespace-pre-wrap break-words leading-relaxed streaming-text">
                                    {msg.content || ''}
                                </div>
                                {#if msg.isStreaming}
                                    <div class="streaming-mask"></div>
                                {/if}
                            </div>
                        {:else if msg.type === 'loading'}
                            <div class="p-3 rounded-2xl text-sm shadow-sm bg-white border border-slate-200 text-slate-700 rounded-tl-none">
                                <div class="flex gap-1 items-center h-5 px-2">
                                    <div class="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"></div>
                                    <div class="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style="animation-delay: 75ms"></div>
                                    <div class="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style="animation-delay: 150ms"></div>
                                </div>
                            </div>
                        {:else if msg.type === 'error'}
                            <div class="p-3 rounded-2xl text-sm shadow-sm bg-red-50 border border-red-200 text-red-700 rounded-tl-none">
                                <div class="flex flex-col gap-2">
                                    <div class="flex items-center gap-2">
                                        <i class="ph-fill ph-warning-circle"></i>
                                        <span>发送失败: {msg.content}</span>
                                    </div>
                                    <button on:click={() => handleRetry(index)}
                                        class="self-start px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-bold hover:bg-red-700 flex items-center gap-1 transition">
                                        <i class="ph ph-arrow-clockwise"></i>
                                        重试
                                    </button>
                                </div>
                            </div>
                        {/if}
                    </div>
                </div>
            {/each}
        {/if}
    </div>

    <div class="p-4 bg-white border-t border-slate-200 shrink-0">
        <div class="flex gap-2 items-end bg-slate-50 p-2 rounded-2xl border border-slate-200 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-50 transition-all">
            <textarea bind:value={inputText}
                on:keydown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
                rows="1"
                placeholder="输入消息..."
                disabled={$isAiLoading}
                class="flex-1 bg-transparent border-none focus:ring-0 text-sm resize-none max-h-32 py-2 text-slate-700 outline-none disabled:opacity-50"></textarea>
            <button on:click={handleSend}
                class="p-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl hover:from-indigo-700 hover:to-purple-700 active:scale-95 transition-all disabled:opacity-50 shadow-lg shadow-indigo-200"
                disabled={!inputText.trim() || $isAiLoading}>
                <i class="ph-bold ph-paper-plane-right text-lg"></i>
            </button>
        </div>
        <div class="mt-2 text-center text-[10px] text-slate-400">
            当前风格: {chatStyles.find(s => s.id === chatStyle)?.name || '默认'} · 按 Enter 发送，Shift+Enter 换行 · 已记住最近 {Math.min($aiChatHistory.filter(m => m.type === 'text').length, 20)} 条对话
        </div>
    </div>
</div>

<style>
    .streaming-text {
        position: relative;
        z-index: 1;
    }

    .streaming-mask {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(
            135deg,
            transparent 0%,
            transparent 60%,
            rgba(255, 255, 255, 0.3) 70%,
            rgba(255, 255, 255, 0.6) 80%,
            rgba(255, 255, 255, 0.9) 90%,
            rgba(255, 255, 255, 1) 100%
        );
        pointer-events: none;
        animation: maskFade 2s ease-in-out infinite;
    }

    @keyframes maskFade {
        0% {
            opacity: 1;
            background-position: 0% 0%;
        }
        50% {
            opacity: 0.7;
            background-position: 100% 100%;
        }
        100% {
            opacity: 1;
            background-position: 0% 0%;
        }
    }
</style>