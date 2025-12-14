<script>
    import { taskStore } from '../stores/tasks.js';
    import { showAlert } from '../stores/modal.js';

    let inputKey = '';
    let validationError = '';

    const KEYBOARD_PATTERNS = [
        'qwertyuiop', 'asdfghjkl', 'zxcvbnm',
        'qwerty', 'asdfgh', 'zxcvbn',
        '1234567890', '0987654321',
        'qazwsx', 'wsxedc', 'edcrfv',
        'poiuytrewq', 'lkjhgfdsa', 'mnbvcxz'
    ];

    function hasConsecutiveChars(str, minLength = 4) {
        const lower = str.toLowerCase();
        for (let i = 0; i <= lower.length - minLength; i++) {
            const segment = lower.slice(i, i + minLength);
            let isConsecutive = true;
            for (let j = 1; j < segment.length; j++) {
                if (segment.charCodeAt(j) - segment.charCodeAt(j - 1) !== 1) {
                    isConsecutive = false;
                    break;
                }
            }
            if (isConsecutive) return true;
        }
        return false;
    }

    function hasRepeatingChars(str, minLength = 4) {
        const lower = str.toLowerCase();
        for (let i = 0; i <= lower.length - minLength; i++) {
            const char = lower[i];
            let count = 1;
            for (let j = i + 1; j < lower.length && lower[j] === char; j++) {
                count++;
            }
            if (count >= minLength) return true;
        }
        return false;
    }

    function containsKeyboardPattern(str) {
        const lower = str.toLowerCase();
        for (const pattern of KEYBOARD_PATTERNS) {
            if (lower.includes(pattern.slice(0, 5))) return true;
            const reversed = pattern.split('').reverse().join('');
            if (lower.includes(reversed.slice(0, 5))) return true;
        }
        return false;
    }

    function isSystemGenerated(key) {
        const pattern = /^user_[a-z0-9]{9}$/;
        if (pattern.test(key)) return true;

        const extendedPattern = /^user_[a-zA-Z0-9_]+_[a-z0-9]{9}$/;
        if (extendedPattern.test(key)) {
            const suffix = key.slice(-9);
            return /^[a-z0-9]{9}$/.test(suffix);
        }

        return false;
    }

    function validateKey(key) {
        if (!key || !key.trim()) {
            return 'Key 不能为空';
        }

        const trimmed = key.trim();

        if (isSystemGenerated(trimmed)) {
            return '';
        }

        if (trimmed.length < 16) {
            return `Key 长度至少需要 16 位，当前 ${trimmed.length} 位`;
        }

        if (trimmed.length > 64) {
            return `Key 长度不能超过 64 位，当前 ${trimmed.length} 位`;
        }

        if (hasConsecutiveChars(trimmed)) {
            return 'Key 不能包含连续的字符序列 (如 abcd, 1234)';
        }

        if (hasRepeatingChars(trimmed)) {
            return 'Key 不能包含重复的字符 (如 aaaa, 1111)';
        }

        if (containsKeyboardPattern(trimmed)) {
            return 'Key 不能包含键盘连续输入模式 (如 qwerty, asdfg)';
        }

        return '';
    }

    async function login() {
        const error = validateKey(inputKey);
        if (error) {
            validationError = error;
            await showAlert({ title: '输入错误', message: error, variant: 'warning' });
            return;
        }
        validationError = '';
        taskStore.login(inputKey.trim());
    }

    function generateKey() {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let suffix = '';
        for (let i = 0; i < 9; i++) {
            suffix += chars[Math.floor(Math.random() * chars.length)];
        }
        inputKey = 'user_' + suffix;
        validationError = '';
    }

    function handleInput() {
        if (inputKey.trim()) {
            validationError = validateKey(inputKey);
        } else {
            validationError = '';
        }
    }
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-100/50 backdrop-blur-sm p-4 safe-area-login">
    <div class="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-md border border-white">
        <div class="text-center mb-8">
            <div class="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center text-white mx-auto shadow-lg mb-4 text-3xl">
                <i class="ph-bold ph-check-square-offset"></i>
            </div>
            <h1 class="text-2xl font-black text-slate-800">WorkPlan Cloud</h1>
            <p class="text-sm text-slate-500 mt-2">输入 Key 访问您的云端数据</p>
        </div>

        <div class="space-y-4">
            <div>
                <label class="text-xs font-bold text-slate-400 uppercase ml-1">Access Key</label>
                <input type="text" bind:value={inputKey} 
                    on:input={handleInput}
                    on:keyup={(e) => e.key === 'Enter' && login()}
                    placeholder="请输入或创建 Key..."
                    class="w-full mt-1 border-2 rounded-xl px-4 py-3 focus:outline-none focus:ring-4 transition font-mono text-center font-bold text-lg bg-slate-50"
                    class:border-slate-100={!validationError}
                    class:focus:border-blue-500={!validationError}
                    class:focus:ring-blue-50={!validationError}
                    class:border-red-300={validationError}
                    class:focus:border-red-500={validationError}
                    class:focus:ring-red-50={validationError}
                    class:text-slate-700={!validationError}
                    class:text-red-600={validationError}>
                {#if validationError}
                    <div class="text-xs text-red-500 mt-2 px-1 flex items-start gap-1">
                        <i class="ph ph-warning shrink-0 mt-0.5"></i>
                        <span>{validationError}</span>
                    </div>
                {/if}
                <div class="text-[10px] text-slate-400 mt-2 px-1">
                    自定义 Key 需要 16-64 位，不能包含连续/重复字符
                </div>
            </div>

            <button on:click={login}
                class="w-full bg-blue-600 text-white font-bold py-3.5 rounded-xl hover:bg-blue-700 transition shadow-lg shadow-blue-200 active:scale-95 text-lg disabled:opacity-50"
                disabled={!!validationError && inputKey.trim().length > 0}>
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

<style>
    .safe-area-login {
        padding-top: env(safe-area-inset-top);
        padding-bottom: env(safe-area-inset-bottom);
    }
</style>