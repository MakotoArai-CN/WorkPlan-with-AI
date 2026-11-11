const PRIVILEGED_ROLES = new Set([
    'service_role', 'postgres', 'supabase_admin', 'supabase_auth_admin', 'authenticator'
]);

export function isPrivilegedDatabaseKey(value) {
    const key = String(value || '').trim();
    if (/^sb_secret_/i.test(key)) return true;
    const parts = key.split('.');
    if (parts.length !== 3) return false;
    try {
        const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const claims = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
        return PRIVILEGED_ROLES.has(claims.role);
    } catch {
        return false;
    }
}

export function assertPublicDatabaseKey(config) {
    // A desktop/WebView is an untrusted public client. Admin keys bypass RLS
    // even after the database policies are correctly installed.
    if (isPrivilegedDatabaseKey(config?.apiKey)) {
        throw new Error('禁止在客户端使用 Supabase secret / service_role 管理密钥，请改用 publishable / anon 公钥并在服务端启用 RLS');
    }
}

export function assertCloudRecordKey(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 512 || /[\u0000-\u001f\u007f]/u.test(value)) {
        throw new Error('云端账号或记录密钥无效');
    }
}
