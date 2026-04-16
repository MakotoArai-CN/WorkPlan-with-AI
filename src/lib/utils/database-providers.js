export const DATABASE_SETUP_SQL = `CREATE TABLE IF NOT EXISTS planpro_data (
    id BIGSERIAL PRIMARY KEY,
    user_key TEXT UNIQUE NOT NULL,
    content JSONB,
    updated_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_planpro_user_key ON planpro_data(user_key);`;

export const DATABASE_PROVIDER_CATALOG = [
    {
        id: 'supabase',
        name: 'Supabase',
        databaseType: 'PostgreSQL',
        freeTier: '500 MB（超过进入只读模式）',
        paidTier: 'Pro 计划起 8 GB（然后 $0.125/GB/月）',
        notes: '免费层磁盘实际 1 GB，但数据大小限 500 MB；Pro 以上可自动扩展到 TB 级。',
        directSync: true
    },
    {
        id: 'neon',
        name: 'Neon',
        databaseType: 'PostgreSQL',
        freeTier: '0.5 GB / 项目（最多 10 项目总 5 GB）',
        paidTier: '按使用付费 $0.35/GB/月，单分支最高 16 TB',
        notes: '存储与计算分离，免费适合原型；如需直接接入本客户端，建议通过 PostgREST / Supabase 兼容网关暴露 HTTP API。',
        directSync: false
    },
    {
        id: 'nhost',
        name: 'Nhost',
        databaseType: 'PostgreSQL',
        freeTier: 'Starter 约 1 GB',
        paidTier: 'Pro 起 10 GB（然后 $0.20/GB）',
        notes: '托管 Postgres，规模化时可轻松升级；若要直连本客户端，建议使用兼容 REST 接口。',
        directSync: false
    },
    {
        id: 'turso',
        name: 'Turso',
        databaseType: 'SQLite (libSQL)',
        freeTier: '5 GB',
        paidTier: 'Developer 9 GB 起（然后 $0.50–$0.75/GB）',
        notes: '免费层很慷慨，适合多数据库场景；当前设置页可保存接入信息，后续可切换 libSQL 适配。',
        directSync: false
    },
    {
        id: 'pocketbase',
        name: 'PocketBase',
        databaseType: 'SQLite',
        freeTier: '无限制（自托管）',
        paidTier: '无（自托管）',
        notes: '容量取决于你的 VPS / 服务器磁盘大小；适合单文件数据库场景。',
        directSync: false
    },
    {
        id: 'appwrite',
        name: 'Appwrite',
        databaseType: 'MariaDB',
        freeTier: '云托管：2 GB 存储',
        paidTier: '云：150 GB+；自托管：无限制',
        notes: '自托管完全由服务器磁盘决定；云版有明确存储配额。',
        directSync: false
    },
    {
        id: 'firebase',
        name: 'Firebase (Firestore)',
        databaseType: 'NoSQL (文档型)',
        freeTier: '1 GiB 存储数据',
        paidTier: '按使用付费，无硬上限',
        notes: '单文档最大 1 MiB；总存储可扩展，但数据模型与 SQL 差异较大。',
        directSync: false
    },
    {
        id: 'self-hosted',
        name: '自托管',
        databaseType: '自定义',
        freeTier: '取决于服务器',
        paidTier: '取决于服务器',
        notes: '推荐自托管 Supabase / PostgREST / PocketBase。若使用 PostgreSQL，请先用上方 SQL 建表并暴露兼容 HTTP API。',
        directSync: true
    }
];

export function getDefaultDatabaseConfig() {
    return {
        enabled: false,
        useCustomConfig: false,
        service: 'supabase',
        url: '',
        apiKey: '',
        tableName: 'planpro_data',
        databaseName: '',
        projectId: '',
        region: '',
        notes: ''
    };
}

export function getDatabaseProviderMeta(service) {
    return DATABASE_PROVIDER_CATALOG.find((item) => item.id === service) || DATABASE_PROVIDER_CATALOG[0];
}
