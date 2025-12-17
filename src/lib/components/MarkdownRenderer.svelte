<script>
    import { renderMarkdown, isMarkdown } from '../utils/markdown.js';
    import { onMount } from 'svelte';
    
    export let content = '';
    export let inline = false;
    
    let renderedContent = '';
    let container;
    
    $: {
        if (isMarkdown(content)) {
            renderedContent = renderMarkdown(content);
        } else {
            renderedContent = null;
        }
    }
    
    onMount(() => {
        const style = document.createElement('link');
        style.rel = 'stylesheet';
        style.href = 'https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github.min.css';
        document.head.appendChild(style);
        
        const katexStyle = document.createElement('link');
        katexStyle.rel = 'stylesheet';
        katexStyle.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css';
        document.head.appendChild(katexStyle);
        
        return () => {
            if (style.parentNode) style.parentNode.removeChild(style);
            if (katexStyle.parentNode) katexStyle.parentNode.removeChild(katexStyle);
        };
    });
    
    $: isPlainText = !renderedContent;
</script>

{#if isPlainText}
    {#if inline}
        <span class="whitespace-pre-wrap">{content}</span>
    {:else}
        <div class="whitespace-pre-wrap">{content}</div>
    {/if}
{:else}
    {#if inline}
        <span bind:this={container} class="markdown-content inline-markdown">{@html renderedContent}</span>
    {:else}
        <div bind:this={container} class="markdown-content">{@html renderedContent}</div>
    {/if}
{/if}

<style>
    :global(.markdown-content) {
        line-height: 1.6;
        color: #1e293b;
    }

    :global(.markdown-content h1) {
        font-size: 2em;
        font-weight: 700;
        margin: 1em 0 0.5em;
        border-bottom: 2px solid #e2e8f0;
        padding-bottom: 0.3em;
        color: #0f172a;
    }

    :global(.markdown-content h2) {
        font-size: 1.5em;
        font-weight: 700;
        margin: 0.8em 0 0.4em;
        border-bottom: 1px solid #e2e8f0;
        padding-bottom: 0.2em;
        color: #0f172a;
    }

    :global(.markdown-content h3) {
        font-size: 1.25em;
        font-weight: 600;
        margin: 0.6em 0 0.3em;
        color: #334155;
    }

    :global(.markdown-content h4) {
        font-size: 1.1em;
        font-weight: 600;
        margin: 0.5em 0 0.25em;
        color: #334155;
    }

    :global(.markdown-content h5),
    :global(.markdown-content h6) {
        font-size: 1em;
        font-weight: 600;
        margin: 0.5em 0 0.25em;
        color: #475569;
    }

    :global(.markdown-content p) {
        margin: 0.8em 0;
    }

    :global(.markdown-content ul),
    :global(.markdown-content ol) {
        margin: 0.8em 0;
        padding-left: 2em;
    }

    :global(.markdown-content li) {
        margin: 0.4em 0;
    }

    :global(.markdown-content .task-list-item) {
        list-style: none;
        margin-left: -2em;
        padding-left: 2em;
        display: flex;
        align-items: flex-start;
        gap: 0.5em;
    }

    :global(.markdown-content .task-list-item input[type="checkbox"]) {
        margin-top: 0.35em;
        cursor: not-allowed;
    }

    :global(.markdown-content code) {
        background: #f1f5f9;
        color: #e11d48;
        padding: 0.2em 0.4em;
        border-radius: 0.25em;
        font-size: 0.9em;
        font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace;
    }

    :global(.markdown-content pre) {
        background: #1e293b;
        color: #e2e8f0;
        padding: 1em;
        border-radius: 0.5em;
        overflow-x: auto;
        margin: 1em 0;
        border: 1px solid #334155;
    }

    :global(.markdown-content pre code) {
        background: transparent;
        padding: 0;
        color: inherit;
        font-size: 0.875em;
    }

    :global(.markdown-content blockquote) {
        border-left: 4px solid #3b82f6;
        margin: 1em 0;
        padding: 0.5em 1em;
        background: #eff6ff;
        color: #1e40af;
        border-radius: 0 0.25em 0.25em 0;
    }

    :global(.markdown-content blockquote p:first-child) {
        margin-top: 0;
    }

    :global(.markdown-content blockquote p:last-child) {
        margin-bottom: 0;
    }

    :global(.markdown-content .table-wrapper) {
        overflow-x: auto;
        margin: 1em 0;
    }

    :global(.markdown-content table) {
        width: 100%;
        border-collapse: collapse;
        margin: 0;
    }

    :global(.markdown-content th),
    :global(.markdown-content td) {
        border: 1px solid #e2e8f0;
        padding: 0.6em 0.8em;
        text-align: left;
    }

    :global(.markdown-content th) {
        background: #f8fafc;
        font-weight: 600;
        color: #0f172a;
    }

    :global(.markdown-content tr:nth-child(even)) {
        background: #f8fafc;
    }

    :global(.markdown-content a) {
        color: #3b82f6;
        text-decoration: none;
        border-bottom: 1px solid transparent;
        transition: border-color 0.2s;
    }

    :global(.markdown-content a:hover) {
        border-bottom-color: #3b82f6;
    }

    :global(.markdown-content hr) {
        border: none;
        border-top: 2px solid #e2e8f0;
        margin: 2em 0;
    }

    :global(.markdown-content img) {
        max-width: 100%;
        height: auto;
        border-radius: 0.5em;
        margin: 1em 0;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }

    :global(.markdown-content del) {
        text-decoration: line-through;
        color: #94a3b8;
    }

    :global(.markdown-content .mermaid-container) {
        background: white;
        padding: 1em;
        border-radius: 0.5em;
        margin: 1em 0;
        border: 1px solid #e2e8f0;
        overflow-x: auto;
    }

    :global(.markdown-content .mermaid-container svg) {
        max-width: 100%;
        height: auto;
    }

    :global(.markdown-content .mermaid-error) {
        background: #fef2f2;
        border: 1px solid #fecaca;
        border-radius: 0.5em;
        padding: 1em;
        margin: 1em 0;
    }

    :global(.markdown-content .mermaid-error .error-msg) {
        color: #dc2626;
        font-size: 0.875em;
        margin-top: 0.5em;
    }

    :global(.markdown-content .alert) {
        padding: 1em;
        border-radius: 0.5em;
        margin: 1em 0;
        border-left: 4px solid;
        display: flex;
        gap: 0.75em;
        align-items: flex-start;
    }

    :global(.markdown-content .alert i) {
        font-size: 1.25em;
        margin-top: 0.1em;
    }

    :global(.markdown-content .alert-content) {
        flex: 1;
    }

    :global(.markdown-content .alert-note) {
        background: #eff6ff;
        border-left-color: #3b82f6;
        color: #1e40af;
    }

    :global(.markdown-content .alert-note i) {
        color: #3b82f6;
    }

    :global(.markdown-content .alert-tip) {
        background: #f0fdf4;
        border-left-color: #22c55e;
        color: #166534;
    }

    :global(.markdown-content .alert-tip i) {
        color: #22c55e;
    }

    :global(.markdown-content .alert-important) {
        background: #fef3c7;
        border-left-color: #f59e0b;
        color: #92400e;
    }

    :global(.markdown-content .alert-important i) {
        color: #f59e0b;
    }

    :global(.markdown-content .alert-warning) {
        background: #fef2f2;
        border-left-color: #ef4444;
        color: #991b1b;
    }

    :global(.markdown-content .alert-warning i) {
        color: #ef4444;
    }

    :global(.markdown-content .alert-caution) {
        background: #fdf2f8;
        border-left-color: #ec4899;
        color: #831843;
    }

    :global(.markdown-content .alert-caution i) {
        color: #ec4899;
    }

    :global(.markdown-content .katex) {
        font-size: 1.1em;
    }

    :global(.markdown-content .katex-display) {
        margin: 1em 0;
        overflow-x: auto;
        overflow-y: hidden;
    }

    :global(.inline-markdown) {
        display: inline;
    }

    :global(.inline-markdown p) {
        display: inline;
        margin: 0;
    }

    :global(.hljs) {
        background: #1e293b !important;
        color: #e2e8f0 !important;
    }
</style>