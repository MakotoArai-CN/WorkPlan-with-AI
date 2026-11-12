import { register, init, locale, waitLocale } from 'svelte-i18n';
import '../../../static/locale-init.js';

const SUPPORTED = ['zh', 'zh-Hant', 'en', 'ja', 'ko', 'ru'];
const STORAGE_KEY = 'workplan_locale';

function deepMerge(base, override) {
    if (Array.isArray(base) || Array.isArray(override)) {
        return override ?? base;
    }
    if (base && override && typeof base === 'object' && typeof override === 'object') {
        const merged = { ...base };
        for (const [key, value] of Object.entries(override)) {
            merged[key] = key in base ? deepMerge(base[key], value) : value;
        }
        return merged;
    }
    return override ?? base;
}

async function loadEn() {
    return (await import('./en.json')).default;
}

async function loadZh() {
    return (await import('./zh.json')).default;
}

async function loadJa() {
    return (await import('./ja.json')).default;
}

register('en', loadEn);
register('zh', loadZh);
register('ja', loadJa);
register('zh-Hant', async () => deepMerge(await loadZh(), {
    nav: {
        dashboard: '任務看板',
        scheduled: '定時任務',
        notes: '工作筆記',
        ai_chat: 'AI 對話'
    },
    dashboard: {
        title: '今日看板',
        subtitle: '管理每日待辦'
    },
    notes: {
        title: '工作筆記',
        subtitle: '支援 Markdown'
    },
    settings: {
        theme_rose: '莓粉晨光',
        language: '語言'
    }
}));
register('ko', async () => deepMerge(await loadEn(), {
    nav: {
        dashboard: '작업 보드',
        templates_full: '작업 템플릿',
        scheduled: '예약 작업',
        notes: '업무 노트',
        statistics: '통계',
        passwords: '비밀번호',
        settings: '설정',
        ai_chat: 'AI 채팅'
    },
    settings: {
        theme_rose: '로즈'
    }
}));
register('ru', async () => deepMerge(await loadEn(), {
    nav: {
        dashboard: 'Доска задач',
        templates_full: 'Шаблоны задач',
        scheduled: 'Задачи по расписанию',
        notes: 'Рабочие заметки',
        statistics: 'Статистика',
        passwords: 'Пароли',
        settings: 'Настройки',
        ai_chat: 'AI-чат'
    },
    settings: {
        theme_rose: 'Розовая'
    }
}));

function normalizeLocale(input = '') {
    return (typeof window === 'undefined' ? globalThis : window).WorkPlanLocale.normalize(input) || 'en';
}

function resolveLocale() {
    return (typeof window === 'undefined' ? globalThis : window).WorkPlanLocale.current();
}

export function setupI18n() {
    init({
        fallbackLocale: 'en',
        initialLocale: resolveLocale()
    });
}

export function refreshSystemLocale() {
    locale.set(resolveLocale());
    return waitLocale();
}

locale.subscribe(language => {
    if (typeof document !== 'undefined' && language) document.documentElement.lang = language;
    if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__ && language) {
        import('@tauri-apps/api/core').then(({ invoke }) => invoke('set_app_language', { language })).catch(() => {});
    }
});

export function setLocale(lang) {
    const normalized = normalizeLocale(lang);
    if (!SUPPORTED.includes(normalized)) return;
    locale.set(normalized);
    try {
        localStorage.setItem(STORAGE_KEY, normalized);
    } catch {}
}

export function toIntlLocale(lang) {
    const normalized = normalizeLocale(lang);
    if (normalized === 'zh') return 'zh-CN';
    if (normalized === 'zh-Hant') return 'zh-TW';
    if (normalized === 'ja') return 'ja-JP';
    if (normalized === 'ko') return 'ko-KR';
    if (normalized === 'ru') return 'ru-RU';
    return 'en-US';
}

export { locale };
export const supportedLocales = [
    { code: 'zh', label: '中文' },
    { code: 'zh-Hant', label: '繁體中文' },
    { code: 'en', label: 'English' },
    { code: 'ja', label: '日本語' },
    { code: 'ko', label: '한국어' },
    { code: 'ru', label: 'Русский' }
];
