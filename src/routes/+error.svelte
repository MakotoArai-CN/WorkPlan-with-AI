<script>
    import { page } from '$app/stores';
</script>

<div class="h-screen flex flex-col items-center justify-center bg-slate-100 text-slate-800">
    <div class="text-6xl mb-4">😵</div>
    <h1 class="text-2xl font-bold mb-2">出错了</h1>
    <p class="text-slate-500 mb-4">错误代码: {$page.status}</p>
    <p class="text-slate-400 text-sm mb-6">{$page.error?.message}</p>
    <a href="/" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
        返回首页
    </a>
</div>