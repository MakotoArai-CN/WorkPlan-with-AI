import { describe, test, expect } from 'bun:test';
import { getProviderList } from '../src/lib/utils/ai-providers.js';

const providers = await getProviderList();
const byId = Object.fromEntries(providers.map((provider) => [provider.id, provider]));

describe('AI provider presets', () => {
    test('every preset default model is part of its advertised list', () => {
        for (const provider of providers) {
            if (!provider.defaultModel || !Array.isArray(provider.models) || provider.models.length === 0) {
                continue;
            }
            expect(provider.models, `${provider.id} defaultModel missing from models`).toContain(provider.defaultModel);
        }
    });

    test('major providers expose current model ids', () => {
        expect(byId.openai.models).toContain('gpt-6.1-sol');
        expect(byId.deepseek.models).toContain('deepseek-flash');
        expect(byId.groq.models).toContain('openai/gpt-oss-120b');
        expect(byId.anthropic.models).toContain('claude-sonnet-5-5');
        expect(byId.google.models).toContain('gemini-4-argon');
        expect(byId.moonshot.models).toContain('kimi-k3.1-pro');
        expect(byId.minimax.models).toContain('MiniMax-M3.1-Flash');
        expect(byId.cohere.models).toContain('command-a-plus-05-2026');
        expect(byId.perplexity.models).toContain('perplexity/sonar');
    });

    test('retired model ids are gone', () => {
        expect(byId.deepseek.models).not.toContain('deepseek-v4');
        expect(byId.openai.models).not.toContain('gpt-4.1-mini');
        expect(byId.minimax.models).not.toContain('abab6.5s-chat');
        expect(byId.cohere.models).not.toContain('command-r-plus');
        expect(byId.perplexity.models).not.toContain('llama-3.1-sonar-large-128k-online');
    });

    test('xAI is available with Grok models', () => {
        expect(byId.xai).toBeDefined();
        expect(byId.xai.defaultModel).toBe('grok-4.7');
        expect(byId.xai.models.length).toBeGreaterThan(0);
    });

    test('Magpie local gateway exposes the auto/minimax-m3.1-flash default', () => {
        expect(byId.magpie).toBeDefined();
        expect(byId.magpie.defaultModel).toBe('auto/minimax-m3.1-flash');
        expect(byId.magpie.models).toContain('auto/minimax-m3.1-flash');
        expect(byId.magpie.supportsCustomEndpoint).toBe(true);
    });

    test('providers with changed APIs expose the new capabilities', () => {
        expect(byId.anthropic.supportsModelList).toBe(true);
        expect(byId.minimax.defaultModel).toBe('MiniMax-M3.1-Flash');
    });
});
