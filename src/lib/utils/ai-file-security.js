// Automatic tool reads are less explicit than the user's attachment picker.
// Never turn project secrets or this app's own data into model context.
export function isSensitiveAiPath(value = '') {
    let path = String(value || '');
    try { path = decodeURIComponent(path); } catch { /* Keep the original malformed path blocked below where possible. */ }
    return /(?:^|[\\/])(?:\.workplan|\.ssh|\.gnupg|\.git)(?:[\\/]|$)/i.test(path)
        || /(?:^|[\\/])(?:\.env(?:\.[^\\/]*)?|\.npmrc|\.netrc|\.pypirc|\.local-db-key|\.device-key|id_rsa|id_ed25519|[^\\/]*\.(?:pem|pfx|p12|key|kdbx)|credentials(?:\.json)?|secrets?\.(?:ya?ml|json))$/i.test(path);
}

export function redactAiSecrets(text = '') {
    return String(text)
        .replace(/-----BEGIN [^-]+PRIVATE KEY-----[\s\S]+?-----END [^-]+PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
        .replace(/\b(?:sk-[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]+|AKIA[0-9A-Z]{16})\b/g, '[REDACTED]')
        .replace(/((?:api|secret|access)[-_]?(?:key|token)|password|passphrase)\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi, '$1=[REDACTED]');
}
