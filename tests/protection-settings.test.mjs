import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const component = readFileSync(new URL('../src/lib/components/VaultProtectionSettings.svelte', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/lib/components/Settings.svelte', import.meta.url), 'utf8');

test('protection is a compact accessible switch near the end of settings', () => {
    expect(component).toContain('role="switch" aria-checked={enabled}');
    expect(component).not.toContain('type="checkbox"');
    const section = component.slice(component.indexOf('<section'), component.indexOf('</section>'));
    expect(section).toContain("passwords.protection_brief");
    expect(section).not.toContain('protection_warning');
    expect(section).not.toContain('bind:value={master}');
    expect(settings.indexOf('<VaultProtectionSettings />')).toBeGreaterThan(settings.indexOf("settings.window"));
    expect(settings.indexOf('<VaultProtectionSettings />')).toBeLessThan(settings.indexOf("settings.about"));
});

test('the switch commits only after modal confirmation; cancel clears the draft', () => {
    expect(component).toContain('let pendingEnabled = enabled');
    expect(component).toContain('pendingEnabled = nextEnabled');
    expect(component).toContain('passwordsStore.setProtection(pendingEnabled, master, pendingAction)');
    expect(component).toContain('enabled = committed.enabled');
    expect(component).toContain('dismissible={!busy}');
    expect(component).toContain('pendingEnabled ? $_(\'passwords.protection_warning\')');
    expect(component).toContain('showDialog = false;');
});
