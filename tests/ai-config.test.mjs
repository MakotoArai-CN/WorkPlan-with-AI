import { describe, expect, test } from 'bun:test';
import { pruneProviderConfigs, migrateRemovedProvider } from '../src/lib/utils/ai-config.js';

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
    expect(migrated.provider).toBe('custom');
    expect(migrated.apiKey).toBe('');
    expect(migrated.customEndpoint).toBe('');
    expect(migrated.providerConfigs.custom).toEqual({});
    expect(migrated.providerConfigs['g4f-default']).toBeUndefined();
    expect(old.apiKey).toBe('old-credential');
    expect(migrateRemovedProvider(migrated)).toEqual(migrated);
    expect(migrateRemovedProvider({provider:'openai',apiKey:'keep'}).apiKey).toBe('keep');
});
