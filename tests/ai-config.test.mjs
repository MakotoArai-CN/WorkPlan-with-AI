import { describe, expect, test } from 'bun:test';
import { pruneProviderConfigs, migrateRemovedProvider, resolveModelAfterRefresh } from '../src/lib/utils/ai-config.js';

const key = 'sk-test-custom';

describe('AI provider config cleanup', () => {
    test('removes configs that no remaining connection uses', () => {
        const configs = {
            custom: { apiKey: key, customEndpoint: 'https://llm.example/v1' },
            'g4f-default': { apiKey: '' }
        };
        const remaining = [{ id: 'g4f', provider: 'g4f-default' }];
        expect(pruneProviderConfigs(configs, remaining)).toEqual({
            'g4f-default': { apiKey: '' }
        });
    });

    test('keeps a config when another connection still uses the provider', () => {
        const configs = { custom: { apiKey: key } };
        const remaining = [
            { id: 'a', provider: 'custom' },
            { id: 'b', provider: 'custom' }
        ];
        expect(pruneProviderConfigs(configs, remaining)).toEqual(configs);
    });

    test('handles missing config or provider fields', () => {
        expect(pruneProviderConfigs(null, [{ id: 'x' }])).toEqual({});
        expect(pruneProviderConfigs({ custom: { apiKey: key } }, [])).toEqual({});
    });
});

test('retired profiles require explicit fresh setup without moving credentials to another service', () => {
    const old = { id: 'kept-id', name: 'Connection', provider: 'g4f-default', apiKey: 'old-credential', customEndpoint: 'https://old.invalid',
        providerConfigs: { 'g4f-default': { apiKey: 'old-credential' }, custom: { apiKey: 'cached-other-credential', customEndpoint: 'https://other.invalid' } } };
    const migrated = migrateRemovedProvider(old);
    expect(migrated.id).toBe('kept-id');
    expect(migrated.name).toBe('Connection');
    expect(migrated.provider).toBe('custom');
    expect(migrated.apiKey).toBe('');
    expect(migrated.customEndpoint).toBe('');
    expect(migrated.providerConfigs.custom).toEqual({});
    expect(migrated.providerConfigs['g4f-default']).toBeUndefined();
    expect(old.apiKey).toBe('old-credential');
    expect(migrateRemovedProvider(migrated)).toEqual(migrated);
    expect(migrateRemovedProvider({provider:'openai',apiKey:'keep'}).apiKey).toBe('keep');
});

test('profile status never becomes part of a connection name and only known default artifacts are repaired', () => {
    for (const name of ['默认连接', '连接 2', '我的服务', 'Company（需重新配置）']) {
        expect(migrateRemovedProvider({provider:'g4f-default',name}).name).toBe(name);
    }
    expect(migrateRemovedProvider({provider:'custom',name:'默认连接（需重新配置）',model:'auto'}).name).toBe('默认连接');
    expect(migrateRemovedProvider({provider:'custom',name:'连接 2（需重新配置）（需重新配置）'}).name).toBe('连接 2');
    expect(migrateRemovedProvider({provider:'custom',name:'我的服务（需重新配置）'}).name).toBe('我的服务（需重新配置）');
    expect(migrateRemovedProvider({provider:'custom',name:'默认连接（需重新配置）',customEndpoint:'https://example.com'}).name).toBe('默认连接（需重新配置）');
});

describe('resolveModelAfterRefresh', () => {
    test('preserves a saved built-in provider model even when refreshed models omit it', () => {
        expect(resolveModelAfterRefresh({
            providerId: 'openai',
            savedModel: 'gpt-4o-custom-alias',
            initialModel: 'gpt-4o-custom-alias',
            models: ['gpt-6-astra', 'gpt-6.1-sol'],
            defaultModel: 'gpt-6.1-sol'
        })).toBeNull();
    });

    test('preserves a saved custom provider model when /models returns a different list', () => {
        expect(resolveModelAfterRefresh({
            providerId: 'custom',
            savedModel: 'my-private-deployment',
            initialModel: 'my-private-deployment',
            models: ['llama-3.3-70b', 'qwen-2.5-72b']
        })).toBeNull();
    });

    test('fills empty custom model from refreshed list without overwriting user edits', () => {
        expect(resolveModelAfterRefresh({
            providerId: 'custom',
            savedModel: '',
            initialModel: '',
            models: ['llama-3.3-70b', 'qwen-2.5-72b']
        })).toBe('llama-3.3-70b');

        expect(resolveModelAfterRefresh({
            providerId: 'custom',
            savedModel: 'typed-during-fetch',
            initialModel: '',
            models: ['llama-3.3-70b']
        })).toBeNull();
    });

    test('resolves unset or auto built-in model to provider defaultModel before fetched models[0]', () => {
        expect(resolveModelAfterRefresh({
            providerId: 'openai',
            savedModel: 'auto',
            initialModel: 'auto',
            models: ['babbage-002', 'gpt-6.1-sol'],
            defaultModel: 'gpt-6.1-sol'
        })).toBe('gpt-6.1-sol');

        expect(resolveModelAfterRefresh({
            providerId: 'ollama',
            savedModel: '',
            initialModel: '',
            models: ['qwen2.5:14b'],
            defaultModel: ''
        })).toBe('qwen2.5:14b');
    });
});
