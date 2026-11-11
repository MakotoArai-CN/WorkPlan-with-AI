import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectReleaseAssets, renderReleaseNotes, writeReleaseChecksums } from '../packaging/release-notes.mjs';

const temporaryDirectories = [];
afterEach(async () => {
    for (const directory of temporaryDirectories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe('release packaging', () => {
    test('collects installers, Arch rebuild recipes and checksum sidecars, but not arbitrary files', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'workplan-release-'));
        temporaryDirectories.push(directory);
        await mkdir(join(directory, 'arch'));
        for (const name of ['workplan-bin-0.5.12-1-x86_64.pkg.tar.zst', 'workplan-bin-0.5.12-1.src.tar.gz']) await writeFile(join(directory, 'arch', name), 'asset');
        await writeFile(join(directory, 'archive.tar.gz.sha256'), 'checksum');
        await writeFile(join(directory, 'ignored.txt'), 'not an installer');
        const assets = await collectReleaseAssets(directory);
        expect(assets).toHaveLength(3);
        expect(assets.some(asset => asset.name.endsWith('.pkg.tar.zst'))).toBe(true);
        expect(assets.some(asset => asset.name.endsWith('.src.tar.gz'))).toBe(true);
        expect(assets.some(asset => asset.name.endsWith('.sha256'))).toBe(true);
    });

    test('rejects duplicate asset basenames instead of overwriting release downloads', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'workplan-release-'));
        temporaryDirectories.push(directory);
        await mkdir(join(directory, 'first'));
        await mkdir(join(directory, 'second'));
        await writeFile(join(directory, 'first', 'installer.exe'), 'first');
        await writeFile(join(directory, 'second', 'installer.exe'), 'second');
        await expect(collectReleaseAssets(directory)).rejects.toThrow('Duplicate release asset');
    });

    test('streams deterministic SHA-256 hashes with filenames relative to the download directory', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'workplan-release-'));
        temporaryDirectories.push(directory);
        await writeFile(join(directory, 'installer.exe'), 'abc');
        await writeReleaseChecksums(await collectReleaseAssets(directory), join(directory, 'SHA256SUMS'));
        expect(await readFile(join(directory, 'SHA256SUMS'), 'utf8')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  installer.exe\n');
    });

    test('rejects filenames which could corrupt the checksum manifest', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'workplan-release-'));
        temporaryDirectories.push(directory);
        await writeFile(join(directory, 'installer with spaces.exe'), 'asset');
        await expect(collectReleaseAssets(directory)).rejects.toThrow('Unsafe release asset name');
    });

    test('renders grouped actual downloads, install guidance and integrity instructions', () => {
        const names = ['WorkPlan_0.5.12_x64-setup.exe', 'WorkPlan_0.5.12_aarch64.dmg', 'WorkPlan_0.5.12_amd64.deb', 'workplan-android-arm64.apk', 'workplan-bin-0.5.12-1-x86_64.pkg.tar.zst', 'WorkPlan_0.5.12_linux-x86_64.tar.gz', 'workplan-bin-0.5.12-1.src.tar.gz'];
        const body = renderReleaseNotes({ version: '0.5.12', repository: 'test/workplan', assets: names.map(name => ({ name, size: 1048576 })), commits: ['fix: <script> @someone [link](bad) `code`'] });
        for (const name of names) expect(body).toContain(`/releases/download/v0.5.12/${name})`);
        expect(body).toContain('sudo pacman -U ./workplan-bin-0.5.12-1-x86_64.pkg.tar.zst');
        expect(body).toContain('sha256sum --check --ignore-missing SHA256SUMS');
        expect(body).toContain('Get-FileHash');
        expect(body).toContain('1.0 MB');
        expect(body).not.toContain('aarch64.pkg.tar.zst');
        expect(body).not.toContain('<script>');
        expect(body).not.toContain('@someone');
    });

    test('rejects untrusted release metadata', () => {
        expect(() => renderReleaseNotes({ version: 'bad\nvalue', repository: 'test/workplan', assets: [] })).toThrow('Invalid release version');
        expect(() => renderReleaseNotes({ version: '0.5.12', repository: '../escape', assets: [] })).toThrow('Invalid repository');
    });

    test('release builds Arch from the same run and waits for verification before publishing', async () => {
        const workflow = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
        expect(workflow).toContain('uses: ./.github/workflows/arch-package.yml');
        expect(workflow).toContain('portable-artifact: linux-portable');
        expect(workflow).toContain('build-linux, build-arch, build-macos');
        expect(workflow).toContain('artifacts/**/*.pkg.tar.zst');
        expect(workflow).toContain('artifacts/SHA256SUMS');
        const arch = await readFile(new URL('../.github/workflows/arch-package.yml', import.meta.url), 'utf8');
        expect(arch).toContain('sudo -u builder makepkg --noconfirm');
        expect(arch).toContain('pacman -Qkk workplan-bin');
        expect(arch).not.toContain('NOPASSWD');
        expect(arch).not.toContain('SKIP');
    });
});
