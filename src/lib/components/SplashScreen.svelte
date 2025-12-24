<script>
    import { onMount } from 'svelte';
    import { fade, scale } from 'svelte/transition';

    export let duration = 1500;
    export let onComplete = () => {};

    let visible = true;
    let progress = 0;
    let mounted = false;

    onMount(() => {
        mounted = true;
        
        const interval = setInterval(() => {
            progress += 2;
            if (progress >= 100) {
                clearInterval(interval);
            }
        }, duration / 50);

        const timer = setTimeout(() => {
            visible = false;
            setTimeout(onComplete, 300);
        }, duration);

        return () => {
            clearTimeout(timer);
            clearInterval(interval);
        };
    });
</script>

{#if visible}
    <div class="splash-screen" class:mounted transition:fade={{ duration: 300 }}>
        <div class="splash-content" in:scale={{ duration: 400, start: 0.8 }}>
            <div class="logo-container">
                <div class="logo">
                    <i class="ph-bold ph-check-square-offset"></i>
                </div>
                <div class="logo-glow"></div>
            </div>
            
            <h1 class="app-title">WorkPlan</h1>
            <p class="app-subtitle">with AI</p>
            
            <div class="progress-container">
                <div class="progress-bar" style="width: {progress}%"></div>
            </div>
            
            <p class="loading-text">正在加载...</p>
        </div>
    </div>
{/if}

<style>
    .splash-screen {
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 50%, #60a5fa 100%);
        opacity: 0;
        transition: opacity 0.1s ease;
    }

    .splash-screen.mounted {
        opacity: 1;
    }

    .splash-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
    }

    .logo-container {
        position: relative;
        margin-bottom: 8px;
    }

    .logo {
        width: 80px;
        height: 80px;
        background: white;
        border-radius: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        animation: float 2s ease-in-out infinite;
    }

    .logo i {
        font-size: 40px;
        color: #2563eb;
    }

    .logo-glow {
        position: absolute;
        inset: -20px;
        background: radial-gradient(circle, rgba(255,255,255,0.3) 0%, transparent 70%);
        border-radius: 50%;
        animation: pulse 2s ease-in-out infinite;
    }

    @keyframes float {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-10px); }
    }

    @keyframes pulse {
        0%, 100% { opacity: 0.5; transform: scale(1); }
        50% { opacity: 0.8; transform: scale(1.1); }
    }

    .app-title {
        font-size: 32px;
        font-weight: 800;
        color: white;
        margin: 0;
        letter-spacing: -0.5px;
        text-shadow: 0 2px 10px rgba(0,0,0,0.2);
    }

    .app-subtitle {
        font-size: 16px;
        color: rgba(255,255,255,0.8);
        margin: -8px 0 0 0;
        font-weight: 500;
    }

    .progress-container {
        width: 200px;
        height: 4px;
        background: rgba(255,255,255,0.2);
        border-radius: 2px;
        overflow: hidden;
        margin-top: 24px;
    }

    .progress-bar {
        height: 100%;
        background: white;
        border-radius: 2px;
        transition: width 0.1s ease;
    }

    .loading-text {
        font-size: 12px;
        color: rgba(255,255,255,0.6);
        margin: 8px 0 0 0;
    }
</style>