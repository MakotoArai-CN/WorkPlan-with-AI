// The G4F integration is generated from g4f.dev's providers.json, so a bad
// upstream sync silently empties the provider picker or leaves ids pointing at
// removed providers. Pin the contract the UI relies on.
import { describe, test, expect } from 'bun:test';
import {
    G4F_PROVIDER_CATALOG,
    getG4FDefaultModels,
    isG4FProvider,
    normalizeG4FProviderId
} from '../src/lib/utils/g4f-client.js';

describe('G4F provider catalog', () => {
    test('exposes the main providers offered by g4f.dev', () => {
        const ids = G4F_PROVIDER_CATALOG.map(provider => provider.id);
        for (const id of [
            'g4f-default',
            'g4f-pollinations',
            'g4f-qwen',
            'g4f-gemini',
            'g4f-groq',
            'g4f-openrouter',
            'g4f-nvidia',
            'g4f-ollama',
            'g4f-airforce',
            'g4f-puter'
        ]) {
            expect(ids).toContain(id);
        }
    });

    test('does not emit duplicate or legacy dotted ids', () => {
        const ids = G4F_PROVIDER_CATALOG.map(provider => provider.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).not.toContain('g4f-api.airforce');
        expect(ids).not.toContain('g4f-azure');
        expect(ids).not.toContain('g4f-custom');
        expect(ids).not.toContain('g4f-master');
    });

    test('every provider resolves to at least one model', () => {
        for (const provider of G4F_PROVIDER_CATALOG) {
            expect(getG4FDefaultModels(provider.id).length).toBeGreaterThan(0);
        }
    });

    test('legacy provider ids migrate to the renamed ones', () => {
        expect(normalizeG4FProviderId('g4f-api.airforce')).toBe('g4f-airforce');
        expect(normalizeG4FProviderId('g4f-master')).toBe('g4f-default');
        // g4f.space/api/azure returns 404 upstream, so old Azure profiles fall back.
        expect(normalizeG4FProviderId('g4f-azure')).toBe('g4f-default');
        expect(normalizeG4FProviderId('g4f-qwen')).toBe('g4f-qwen');
        expect(normalizeG4FProviderId('openai')).toBe('openai');
        expect(isG4FProvider('g4f-default')).toBe(true);
        expect(isG4FProvider('openai')).toBe(false);
    });
});
