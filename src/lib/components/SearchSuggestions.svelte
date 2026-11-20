<script>
    import { _ } from 'svelte-i18n';
    import { openExternalUrl } from '../utils/open-external.js';

    export let suggestions = [];
</script>

{#if suggestions.length}
    <div class="mt-2 text-xs break-words">
        <span class="font-bold">{$_('ai_chat.search_suggestions')}</span>
        <ul class="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {#each suggestions as suggestion (suggestion.url)}
                <li>
                    <a href={suggestion.url} target="_blank" rel="noopener noreferrer" class="underline"
                        on:click|preventDefault={() => openExternalUrl(suggestion.url)}>{suggestion.title}</a>
                </li>
            {/each}
        </ul>
    </div>
{/if}
