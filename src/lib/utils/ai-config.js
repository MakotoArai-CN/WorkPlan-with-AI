/**
 * Provider configs are a shared cache keyed by provider id. When a connection
 * is deleted, entries that no remaining connection references must go too,
 * otherwise an unused custom endpoint keeps its API key in localStorage.
 */
export function pruneProviderConfigs(providerConfigs, profiles) {
    const usedProviders = new Set(
        (profiles || []).map(profile => profile.provider).filter(Boolean)
    );
    return Object.fromEntries(
        Object.entries(providerConfigs || {})
            .filter(([providerId]) => usedProviders.has(providerId))
    );
}

// Retired connections must not carry their credentials to a different host.
// Keep profile identity and user prompts, but require an explicit fresh setup.
export function migrateRemovedProvider(profile = {}) {
    const providerConfigs = Object.fromEntries(Object.entries(profile.providerConfigs || {})
        .filter(([provider]) => !provider.startsWith('g4f-')));
    if (!String(profile.provider || '').startsWith('g4f-')) {
        // Repair only the exact default-name artifact produced by older builds.
        // A user-defined connection name must never be rewritten by migration.
        const generatedName = /^(默认连接|连接 \d+)(?:（需重新配置）)+$/.exec(profile.name || '');
        const emptyMigratedProfile = profile.provider === 'custom' && !profile.apiKey && !profile.secretKey
            && !profile.customEndpoint && !profile.customModel && (!profile.model || profile.model === 'auto');
        return { ...profile, ...(generatedName && emptyMigratedProfile ? { name: generatedName[1] } : {}), providerConfigs };
    }
    return {
        ...profile, provider: 'custom', apiKey: '', secretKey: '', model: '',
        customModel: '', customEndpoint: '', accountId: '', providerConfigs: { ...providerConfigs, custom: {} }
    };
}
