import { writable, get } from 'svelte/store';

const STORAGE_KEY = 'planpro_theme_mode';

function createThemeStore() {
    const { subscribe, set, update } = writable({
        mode: 'auto',
        isDark: false,
        systemDark: false
    });

    let mediaQuery = null;
    let initialized = false;

    function getSystemDark() {
        if (typeof window === 'undefined') return false;
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    function computeIsDark(mode, systemDark) {
        if (mode === 'dark') return true;
        if (mode === 'light') return false;
        return systemDark;
    }

    function applyTheme(isDark) {
        if (typeof document === 'undefined') return;
        
        const root = document.documentElement;
        const body = document.body;
        
        if (isDark) {
            root.classList.add('dark');
            body.classList.add('dark');
            root.style.colorScheme = 'dark';
            document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#0f172a');
        } else {
            root.classList.remove('dark');
            body.classList.remove('dark');
            root.style.colorScheme = 'light';
            document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#1e3a8a');
        }
    }

    function save(mode) {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, mode);
        }
    }

    return {
        subscribe,
        
        init() {
            if (typeof window === 'undefined' || initialized) return;
            initialized = true;

            const savedMode = localStorage.getItem(STORAGE_KEY) || 'auto';
            const systemDark = getSystemDark();
            const isDark = computeIsDark(savedMode, systemDark);

            set({ mode: savedMode, isDark, systemDark });
            applyTheme(isDark);

            mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            const handleChange = (e) => {
                update(s => {
                    const newSystemDark = e.matches;
                    const newIsDark = computeIsDark(s.mode, newSystemDark);
                    applyTheme(newIsDark);
                    return { ...s, systemDark: newSystemDark, isDark: newIsDark };
                });
            };

            if (mediaQuery.addEventListener) {
                mediaQuery.addEventListener('change', handleChange);
            } else {
                mediaQuery.addListener(handleChange);
            }
        },

        setMode(mode) {
            if (!['auto', 'light', 'dark'].includes(mode)) return;
            
            update(s => {
                const isDark = computeIsDark(mode, s.systemDark);
                applyTheme(isDark);
                save(mode);
                return { ...s, mode, isDark };
            });
        },

        toggle() {
            const current = get({ subscribe });
            const modes = ['auto', 'light', 'dark'];
            const nextIndex = (modes.indexOf(current.mode) + 1) % modes.length;
            this.setMode(modes[nextIndex]);
        },

        getMode() {
            return get({ subscribe }).mode;
        },

        isDark() {
            return get({ subscribe }).isDark;
        }
    };
}

export const themeStore = createThemeStore();
export const isDarkMode = {
    subscribe: (fn) => themeStore.subscribe(s => fn(s.isDark))
};
export const themeMode = {
    subscribe: (fn) => themeStore.subscribe(s => fn(s.mode))
};