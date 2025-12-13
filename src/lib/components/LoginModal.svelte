<script>
    import { taskStore } from '../stores/tasks.js';
    import { showAlert } from '../stores/modal.js';

    let inputKey = '';

    async function login() {
        if (!inputKey.trim()) {
            await showAlert({ title: '输入错误', message: 'Key 不能为空', variant: 'warning' });
            return;
        }
        taskStore.login(inputKey.trim());
    }

    function generateKey() {
        inputKey = 'user_' + Math.random().toString(36).substr(2, 9);
    }
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-100/50 backdrop-blur-sm p-4">
    <div class="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-md border border-white">
        <div class="text-center mb-8">
            <div class="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center text-white mx-auto shadow-lg mb-4 text-3xl">
                <i class="ph-bold ph-check-square-offset"></i>
            </div>
            <h1 class="text-2xl font-black text-slate-800">PlanPro Cloud</h1>
            <p class="text-sm text-slate-500 mt-2">输入 Key 访问您的云端数据</p>
        </div>
        <div class="space-y-4">
            <div>
                <label class="text-xs font-bold text-slate-400 uppercase ml-1">Access Key</label>
                <input type="text" bind:value={inputKey} on:keyup={(e) => e.key === 'Enter' && login()}
                    placeholder="请输入或创建 Key..."
                    class="w-full mt-1 border-2 border-slate-100 rounded-xl px-4 py-3 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50 transition font-mono text-center font-bold text-lg text-slate-700 bg-slate-50">
            </div>
            <button on:click={login}
                class="w-full bg-blue-600 text-white font-bold py-3.5 rounded-xl hover:bg-blue-700 transition shadow-lg shadow-blue-200 active:scale-95 text-lg">
                进入工作台
            </button>
            <div class="text-center">
                <button on:click={generateKey}
                    class="text-xs text-blue-500 hover:text-blue-700 font-bold flex items-center justify-center gap-1 mx-auto py-2">
                    <i class="ph-bold ph-magic-wand"></i> 随机生成 Key
                </button>
            </div>
        </div>
    </div>
</div>