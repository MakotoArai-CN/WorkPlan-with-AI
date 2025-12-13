<script>
    import { modalStore, toastStore } from '../stores/modal.js';

    function getVariantStyles(variant) {
        const styles = {
            default: { bg: 'bg-blue-600', hover: 'hover:bg-blue-700', border: 'border-blue-200', icon: 'ph-info', iconColor: 'text-blue-600' },
            danger: { bg: 'bg-red-600', hover: 'hover:bg-red-700', border: 'border-red-200', icon: 'ph-warning', iconColor: 'text-red-600' },
            warning: { bg: 'bg-orange-500', hover: 'hover:bg-orange-600', border: 'border-orange-200', icon: 'ph-warning-circle', iconColor: 'text-orange-500' },
            success: { bg: 'bg-green-600', hover: 'hover:bg-green-700', border: 'border-green-200', icon: 'ph-check-circle', iconColor: 'text-green-600' }
        };
        return styles[variant] || styles.default;
    }

    function getToastStyles(type) {
        const styles = {
            success: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-800', icon: 'ph-check-circle', iconColor: 'text-green-600' },
            error: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-800', icon: 'ph-x-circle', iconColor: 'text-red-600' },
            warning: { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-800', icon: 'ph-warning', iconColor: 'text-orange-500' },
            info: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-800', icon: 'ph-info', iconColor: 'text-blue-600' }
        };
        return styles[type] || styles.info;
    }

    $: variantStyle = getVariantStyles($modalStore.variant);
</script>

{#if $modalStore.show}
    <div class="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <div on:click={$modalStore.onCancel || (() => {})} class="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"></div>
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md relative overflow-hidden transform transition-all animate-modal-in">
            <div class="p-6 text-center">
                <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
                    <i class="ph-fill {variantStyle.icon} text-3xl {variantStyle.iconColor}"></i>
                </div>
                <h3 class="text-xl font-bold text-slate-800 mb-2">{$modalStore.title}</h3>
                <p class="text-slate-600 text-sm leading-relaxed whitespace-pre-wrap">{$modalStore.message}</p>
            </div>
            <div class="px-6 pb-6 flex gap-3">
                {#if $modalStore.type === 'confirm' && $modalStore.onCancel}
                    <button on:click={$modalStore.onCancel}
                        class="flex-1 py-3 px-4 bg-slate-100 text-slate-700 rounded-xl font-bold text-sm hover:bg-slate-200 transition-colors">
                        {$modalStore.cancelText}
                    </button>
                {/if}
                <button on:click={$modalStore.onConfirm}
                    class="flex-1 py-3 px-4 {variantStyle.bg} text-white rounded-xl font-bold text-sm {variantStyle.hover} transition-colors shadow-lg">
                    {$modalStore.confirmText}
                </button>
            </div>
        </div>
    </div>
{/if}

<div class="fixed top-4 right-4 z-[101] flex flex-col gap-2 pointer-events-none">
    {#each $toastStore as toast (toast.id)}
        {@const style = getToastStyles(toast.type)}
        <div class="pointer-events-auto {style.bg} {style.border} border rounded-xl px-4 py-3 shadow-lg flex items-center gap-3 min-w-[280px] max-w-md animate-toast-in">
            <i class="ph-fill {style.icon} text-xl {style.iconColor}"></i>
            <span class="flex-1 text-sm font-medium {style.text}">{toast.message}</span>
            <button on:click={() => toastStore.remove(toast.id)} class="text-slate-400 hover:text-slate-600">
                <i class="ph ph-x"></i>
            </button>
        </div>
    {/each}
</div>

<style>
    @keyframes modal-in {
        from { opacity: 0; transform: scale(0.95); }
        to { opacity: 1; transform: scale(1); }
    }
    @keyframes toast-in {
        from { opacity: 0; transform: translateX(100%); }
        to { opacity: 1; transform: translateX(0); }
    }
    .animate-modal-in { animation: modal-in 0.2s ease-out; }
    .animate-toast-in { animation: toast-in 0.3s ease-out; }
</style>