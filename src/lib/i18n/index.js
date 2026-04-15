import { register, init, getLocaleFromNavigator, locale } from 'svelte-i18n';

const SUPPORTED = ['zh', 'en', 'ja'];
const STORAGE_KEY = 'planpro_locale';

register('en', () => import('./en.json'));
register('zh', () => import('./zh.json'));
register('ja', () => import('./ja.json'));

function resolveLocale() {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (saved && SUPPORTED.includes(saved)) return saved;
    const nav = getLocaleFromNavigator() || '';
    const lang = nav.split('-')[0].toLowerCase();
    return SUPPORTED.includes(lang) ? lang : 'en';
}

export function setupI18n() {
    init({
        fallbackLocale: 'en',
        initialLocale: resolveLocale()
    });
}

export function setLocale(lang) {
    if (!SUPPORTED.includes(lang)) return;
    locale.set(lang);
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, lang);
    }
}

export { locale };
export const supportedLocales = [
    { code: 'zh', label: '中文' },
    { code: 'en', label: 'English' },
    { code: 'ja', label: '日本語' }
];
