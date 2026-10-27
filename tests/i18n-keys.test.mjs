// The report modal grew a copy button labelled with a key that nobody had
// added to the dictionaries, so the button rendered "statistics_page.copy"
// (or nothing) instead of 复制. Scan every literal i18n key used by the UI and
// fail when any of the three shipped locales is missing it.
import { describe, test, expect } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const LOCALES = ['zh', 'en', 'ja'];
const KEY_CALL = /(?:\$_|getI18n\(_\)|\btr|\bt)\(\s*['"]([A-Za-z0-9_.]+)['"]\s*[,)]/g;

function collectSourceFiles(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        const info = statSync(full);
        if (info.isDirectory()) {
            collectSourceFiles(full, out);
        } else if (/\.(svelte|js)$/.test(name)) {
            out.push(full);
        }
    }
    return out;
}

function loadDictionary(locale) {
    return JSON.parse(readFileSync(join(ROOT, 'src/lib/i18n', `${locale}.json`), 'utf8'));
}

function hasKey(dictionary, key) {
    let node = dictionary;
    for (const part of key.split('.')) {
        if (!node || typeof node !== 'object' || !(part in node)) return false;
        node = node[part];
    }
    return true;
}

function collectUsedKeys() {
    const used = new Map();
    for (const file of collectSourceFiles(join(ROOT, 'src'))) {
        const text = readFileSync(file, 'utf8');
        for (const match of text.matchAll(KEY_CALL)) {
            const key = match[1];
            if (!key.includes('.')) continue;
            if (!used.has(key)) used.set(key, new Set());
            used.get(key).add(relative(ROOT, file));
        }
    }
    return used;
}

describe('i18n dictionaries', () => {
    const dictionaries = Object.fromEntries(LOCALES.map(locale => [locale, loadDictionary(locale)]));

    test('every literal key used by the UI exists in zh/en/ja', () => {
        const missing = [];
        for (const [key, files] of collectUsedKeys()) {
            const absent = LOCALES.filter(locale => !hasKey(dictionaries[locale], key));
            if (absent.length) {
                missing.push(`${key} (missing in ${absent.join(', ')}; used in ${[...files].slice(0, 2).join(', ')})`);
            }
        }
        expect(missing).toEqual([]);
    });

    test('locales expose the same top-level sections', () => {
        const [zh, en, ja] = LOCALES.map(locale => dictionaries[locale]);
        const zhSections = Object.keys(zh).sort();
        expect(Object.keys(en).sort()).toEqual(zhSections);
        expect(Object.keys(ja).sort()).toEqual(zhSections);
    });

    test('report copy label is translated', () => {
        expect(dictionaries.zh.statistics_page.copy).toBeTruthy();
        expect(dictionaries.en.statistics_page.copy).toBeTruthy();
        expect(dictionaries.ja.statistics_page.copy).toBeTruthy();
    });
});
