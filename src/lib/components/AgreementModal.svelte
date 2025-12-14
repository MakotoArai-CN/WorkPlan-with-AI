<script>
    import { settingsStore } from '../stores/settings.js';

    export let isFirstTime = false;

    async function handleAccept() {
        settingsStore.acceptAgreement();
    }

    async function handleReject() {
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('exit_app');
        } catch {
            window.close();
        }
    }

    function handleClose() {
        if (!isFirstTime) {
            settingsStore.hideAgreementModal();
        }
    }

    $: shouldShow = isFirstTime || $settingsStore.showAgreement;
</script>

{#if shouldShow}
    <div class="fixed inset-0 z-[200] flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" 
            on:click={handleClose} on:keydown={handleClose} role="button" tabindex="0"></div>
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl relative flex flex-col max-h-[90vh] overflow-hidden">
            <div class="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-blue-50 shrink-0">
                <h3 class="font-bold text-lg text-blue-800 flex items-center gap-2">
                    <i class="ph ph-scroll"></i> 用户协议与隐私政策
                </h3>
                {#if !isFirstTime}
                    <button on:click={handleClose} class="text-slate-500 hover:text-slate-700">
                        <i class="ph ph-x text-xl"></i>
                    </button>
                {/if}
            </div>

            <div class="flex-1 overflow-y-auto p-6 space-y-6 text-sm text-slate-700 leading-relaxed">
                <section>
                    <h4 class="font-bold text-base text-slate-800 mb-3">用户协议</h4>
                    <div class="space-y-3 text-slate-600">
                        <p>欢迎使用 WorkPlan  with AI（以下简称"本应用"）。在使用本应用之前，请您仔细阅读并充分理解以下协议条款。</p>
                        
                        <p><strong>1. 服务说明</strong></p>
                        <p>本应用是一款任务管理和计划制定工具，提供任务管理、云端同步、AI辅助等功能。本应用仅供个人学习和研究使用。</p>
                        
                        <p><strong>2. 用户责任</strong></p>
                        <p>用户应当合法使用本应用，不得利用本应用从事任何违法违规活动。用户对其使用本应用的行为及其产生的后果承担全部责任。</p>
                        
                        <p><strong>3. 知识产权</strong></p>
                        <p>本应用的所有内容，包括但不限于文字、图片、代码、界面设计等，均受著作权法保护。本项目采用 AGPL-3.0 开源许可证。</p>
                        
                        <p><strong>4. 免责声明</strong></p>
                        <p>本应用按"现状"提供，不提供任何明示或暗示的保证。对于因使用本应用而产生的任何直接或间接损失，开发者不承担任何责任。</p>
                        
                        <p><strong>5. AI服务</strong></p>
                        <p>本应用集成的AI功能由第三方服务商提供，用户需自行遵守各AI服务商的使用条款。AI生成的内容仅供参考，用户需自行判断其准确性。</p>
                    </div>
                </section>

                <section>
                    <h4 class="font-bold text-base text-slate-800 mb-3">隐私政策</h4>
                    <div class="space-y-3 text-slate-600">
                        <p><strong>1. 信息收集</strong></p>
                        <p>本应用收集的信息包括：您创建的任务数据、应用设置偏好、Access Key（用于云端同步）。我们不会收集您的个人身份信息。</p>
                        
                        <p><strong>2. 信息使用</strong></p>
                        <p>收集的信息仅用于：提供任务管理服务、实现多设备数据同步、改进应用功能和用户体验。</p>
                        
                        <p><strong>3. 信息存储</strong></p>
                        <p>您的任务数据存储在 Supabase 云端数据库中，通过您设置的 Access Key 进行加密保护。本地设置存储在您的设备上。</p>
                        
                        <p><strong>4. 信息共享</strong></p>
                        <p>我们不会向任何第三方出售、交易或转让您的数据。使用AI功能时，您的对话内容会发送至相应的AI服务商。</p>
                        
                        <p><strong>5. 数据安全</strong></p>
                        <p>我们采取合理的技术措施保护您的数据安全，但无法保证数据传输的绝对安全性。建议您使用复杂的 Access Key。</p>
                        
                        <p><strong>6. 用户权利</strong></p>
                        <p>您可以随时导出或删除您的数据。如需删除云端数据，请使用应用内的"删库跑路"功能。</p>
                    </div>
                </section>

                <section class="bg-amber-50 border border-amber-200 rounded-lg p-4">
                    <p class="text-amber-800 text-xs">
                        <i class="ph ph-warning-circle"></i> 
                        {#if isFirstTime}
                            点击"同意并继续"表示您已阅读并同意上述协议。如不同意，请点击"不同意并退出"。
                        {:else}
                            您已同意上述协议。如有疑问，请联系开发者。
                        {/if}
                    </p>
                </section>
            </div>

            <div class="p-4 border-t border-slate-100 flex justify-end gap-3 bg-white shrink-0">
                {#if isFirstTime}
                    <button on:click={handleReject}
                        class="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm font-bold">
                        不同意并退出
                    </button>
                    <button on:click={handleAccept}
                        class="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-bold shadow">
                        同意并继续
                    </button>
                {:else}
                    <button on:click={handleClose}
                        class="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-bold shadow">
                        关闭
                    </button>
                {/if}
            </div>
        </div>
    </div>
{/if}