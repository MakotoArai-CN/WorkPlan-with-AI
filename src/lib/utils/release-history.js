import releases from '../release-history.json';

const RELEASE_ROOT = 'https://github.com/MakotoArai-CN/WorkPlan-with-AI/releases/tag/v';

export function getReleaseNotes(version, language = 'zh') {
    const normalized = String(version || '').replace(/^v/, '');
    const entry = releases.find(item => item.version === normalized);
    if (!entry) return '';
    const locale = String(language || 'zh').toLowerCase().split('-')[0];
    return (entry.changes[locale] || entry.changes.en).map(change => `- ${change}`).join('\n');
}

export function officialReleaseUrl(version) {
    const value = String(version || '').replace(/^v/, '');
    return /^\d+\.\d+\.\d+$/.test(value) ? `${RELEASE_ROOT}${value}` : '';
}

export function getReleaseDate(version) {
    return releases.find(entry => entry.version === String(version || '').replace(/^v/, ''))?.date || '';
}

export function publicReleaseNotes(body) {
    const text = String(body || '').slice(0, 40000).replace(/\r\n/g, '\n');
    // Generated release pages include installers and checksums after the notes.
    // Show the actual changelog, not a second copy of the complete download page.
    const start = /^## (?:本次更新|更新日志|What's New|Changes|Changelog)\s*$/im.exec(text);
    if (!start) return text.trim();
    const tail = text.slice(start.index + start[0].length);
    const end = /^## /m.exec(tail);
    return (end ? tail.slice(0, end.index) : tail).trim();
}
