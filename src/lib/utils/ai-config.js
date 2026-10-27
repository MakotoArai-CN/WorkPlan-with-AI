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
