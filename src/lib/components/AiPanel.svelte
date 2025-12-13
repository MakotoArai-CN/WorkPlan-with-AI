<script>
    import { 
        chatHistory, 
        isAiLoading, 
        showAiPanel, 
        showAiSettings, 
        sendAiMessage, 
        confirmAiTask, 
        removeAiMessage,
        getCurrentProvider
    } from '../stores/ai.js';
    import { taskStore } from '../stores/tasks.js';
    import { showAlert } from '../stores/modal.js';

    let inputText = '';
    let chatContainer;

    function scrollToBottom() {
        if (chatContainer) {
            setTimeout(() => {
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }, 50);
        }
    }

    async function handleSend() {
        if (!inputText.trim()) return;
        const text = inputText;
        inputText = '';
        try {
            await sendAiMessage(text);
            scrollToBottom();
        } catch (error) {
            await showAlert({ title: '发送失败', message: error.message, variant: 'danger' });
        }
    }

    function handleConfirmTask(data, index) {
        taskStore.addTask(data);
        confirmAiTask(index);
        chatHistory.update(h => [...h, {
            role: 'assistant',
            type: 'text',
            content: `任务 "${data.title}" 已成功添加到列表！`
        }]);
        scrollToBottom();
    }

    function formatDateTime(d) {
        return d ? d.replace('T', ' ') : '';
    }

    $: if ($chatHistory.length) scrollToBottom();
</script>

<div class="flex flex-col h-full bg-rose-50/30">
    <div class="h-16 border-b border-rose-100 flex items-center justify-between px-6 bg-white shrink-0">
        <h3 class="font-bold text-rose-600 flex items-center gap-2">
            <i class="ph-fill ph-sparkle"></i> AI 助手
        </h3>
        <div class="flex items-center gap-2">
            <button on:click={() => showAiSettings.set(true)}
                class="text-xs font-bold text-rose-500 hover:text-rose-700 px-2 py-1 rounded hover:bg-rose-100 flex items-center gap-1">
                <i class="ph ph-gear"></i> 设置
            </button>
            <button on:click={() => showAiPanel.set(false)}
                class="text-xs font-bold text-slate-500 hover:text-slate-700 px-2 py-1 rounded hover:bg-slate-100 flex items-center gap-1">
                <i class="ph-bold ph-arrow-u-up-left"></i> 返回
            </button>
        </div>
    </div>

    <div bind:this={chatContainer} class="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth">
        <div class="flex gap-3">
            <div class="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center text-rose-600 shrink-0">
                <i class="ph-fill ph-robot"></i>
            </div>
            <div class="bg-white border border-rose-100 p-3 rounded-2xl rounded-tl-none text-sm text-slate-700 shadow-sm max-w-[85%]">
                告诉我你的计划，我来帮你记录。<br>
                <span class="text-xs text-rose-400">例如："周五下午3点开会"</span>
            </div>
        </div>

        {#each $chatHistory as msg, index}
            <div class="flex gap-3" class:flex-row-reverse={msg.role === 'user'}>
                <div class="w-8 h-8 rounded-full shrink-0 flex items-center justify-center"
                    class:bg-blue-100={msg.role === 'user'}
                    class:text-blue-600={msg.role === 'user'}
                    class:bg-rose-100={msg.role !== 'user'}
                    class:text-rose-600={msg.role !== 'user'}>
                    <i class={msg.role === 'user' ? 'ph-fill ph-user' : 'ph-fill ph-robot'}></i>
                </div>
                <div class="p-3 rounded-2xl text-sm shadow-sm max-w-[85%]"
                    class:bg-blue-600={msg.role === 'user'}
                    class:text-white={msg.role === 'user'}
                    class:rounded-tr-none={msg.role === 'user'}
                    class:bg-white={msg.role !== 'user'}
                    class:border={msg.role !== 'user'}
                    class:border-rose-100={msg.role !== 'user'}
                    class:text-slate-700={msg.role !== 'user'}
                    class:rounded-tl-none={msg.role !== 'user'}>
                    {#if msg.type === 'text'}
                        {msg.content}
                    {:else if msg.type === 'loading'}
                        <div class="flex gap-1 items-center h-5 px-2">
                            <div class="w-1.5 h-1.5 bg-rose-400 rounded-full animate-bounce"></div>
                            <div class="w-1.5 h-1.5 bg-rose-400 rounded-full animate-bounce" style="animation-delay: 75ms"></div>
                            <div class="w-1.5 h-1.5 bg-rose-400 rounded-full animate-bounce" style="animation-delay: 150ms"></div>
                        </div>
                    {:else if msg.type === 'task_card'}
                        <div class="mt-1">
                            <div class="mb-2 font-bold opacity-80">确认为您添加？</div>
                            <div class="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-3 text-left">
                                <div class="font-bold text-slate-800 text-base mb-1">{msg.data.title}</div>
                                <div class="text-xs text-slate-500 flex flex-wrap gap-2">
                                    <span class="flex items-center gap-1">
                                        <i class="ph-bold ph-calendar-blank"></i> {formatDateTime(msg.data.date)}
                                    </span>
                                    {#if msg.data.priority === 'urgent'}
                                        <span class="text-orange-500 font-bold">紧急</span>
                                    {/if}
                                </div>
                            </div>
                            <div class="flex gap-2">
                                <button on:click={() => handleConfirmTask(msg.data, index)}
                                    class="flex-1 bg-rose-600 text-white py-1.5 rounded-lg font-bold text-xs hover:bg-rose-700 shadow-sm disabled:opacity-50"
                                    disabled={msg.confirmed}>
                                    {msg.confirmed ? '已添加' : '确认'}
                                </button>
                                {#if !msg.confirmed}
                                    <button on:click={() => removeAiMessage(index)}
                                        class="px-3 py-1.5 bg-slate-100 text-slate-500 rounded-lg font-bold text-xs hover:bg-slate-200">
                                        取消
                                    </button>
                                {/if}
                            </div>
                        </div>
                    {/if}
                </div>
            </div>
        {/each}
    </div>

    <div class="p-4 bg-white border-t border-rose-100 shrink-0">
        <div class="flex gap-2 items-end bg-slate-50 p-2 rounded-xl border border-rose-100 focus-within:border-rose-400 focus-within:ring-2 focus-within:ring-rose-50 transition-all">
            <textarea bind:value={inputText}
                on:keydown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
                rows="1"
                placeholder="输入任务..."
                class="flex-1 bg-transparent border-none focus:ring-0 text-sm resize-none max-h-24 py-2 text-slate-700 outline-none"></textarea>
            <button on:click={handleSend}
                class="p-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 active:scale-95 transition-transform disabled:opacity-50"
                disabled={!inputText.trim() || $isAiLoading}>
                <i class="ph-bold ph-paper-plane-right"></i>
            </button>
        </div>
    </div>
</div>