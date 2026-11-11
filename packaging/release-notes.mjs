import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ASSET_PATTERN = /\.(?:deb|rpm|AppImage|exe|msi|dmg|apk|pkg\.tar\.zst|tar\.gz|sha256)$/;
const escapeMarkdown = value => String(value).replace(/([\\`*_[\]<>|])/g, '\\$1').replace(/@/g, '&#64;').replace(/[\r\n]+/g, ' ');

export async function collectReleaseAssets(directory) {
    const assets = [];
    const names = new Set();
    async function walk(path) {
        for (const entry of await readdir(path, { withFileTypes: true })) {
            const file = join(path, entry.name);
            if (entry.isDirectory()) await walk(file);
            else if (entry.isFile() && ASSET_PATTERN.test(entry.name)) {
                if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(entry.name)) throw new Error(`Unsafe release asset name: ${entry.name}`);
                if (names.has(entry.name)) throw new Error(`Duplicate release asset: ${entry.name}`);
                names.add(entry.name);
                assets.push({ name: entry.name, path: file, size: (await stat(file)).size });
            }
        }
    }
    await walk(directory);
    return assets.sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

export async function writeReleaseChecksums(assets, destination) {
    const lines = [];
    for (const asset of assets) {
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(asset.path)) hash.update(chunk);
        lines.push(`${hash.digest('hex')}  ${asset.name}`);
    }
    await writeFile(destination, `${lines.join('\n')}\n`);
}

export function renderReleaseNotes({ version, repository, assets, commits = [] }) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version');
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repository)) throw new Error('Invalid repository');
    const base = `https://github.com/${repository}/releases/download/v${version}`;
    const link = name => `[${escapeMarkdown(name)}](${base}/${encodeURIComponent(name)})`;
    const rows = list => list.map(asset => `| ${link(asset.name)} | ${(asset.size / 1048576).toFixed(1)} MB |`).join('\n');
    const table = list => `| 安装包 | 大小 |\n| :--- | ---: |\n${rows(list)}`;
    const windows = assets.filter(asset => /\.(exe|msi)$/.test(asset.name));
    const mac = assets.filter(asset => asset.name.endsWith('.dmg'));
    const linux = assets.filter(asset => /\.(deb|rpm|AppImage)$/.test(asset.name));
    const arch = assets.filter(asset => /(?:\.pkg\.tar\.zst|_linux-x86_64\.tar\.gz)$/.test(asset.name));
    const android = assets.filter(asset => asset.name.endsWith('.apk'));
    const source = assets.filter(asset => asset.name.endsWith('.src.tar.gz'));
    const archPackage = assets.find(asset => asset.name.endsWith('-x86_64.pkg.tar.zst'));
    const portable = assets.find(asset => asset.name.endsWith('_linux-x86_64.tar.gz'));
    const changes = commits.length ? commits.map(commit => `- ${escapeMarkdown(commit)}`).join('\n') : '- 本次发布同步了应用与安装包版本。';
    const sections = [
        `<div align="center">\n\n# WorkPlan ${version}\n\n任务 · 笔记 · 密码本 · AI 助手\n\n![Windows](https://img.shields.io/badge/Windows-0078D6?style=flat-square&logo=windows&logoColor=white) ![macOS](https://img.shields.io/badge/macOS-222222?style=flat-square&logo=apple&logoColor=white) ![Linux](https://img.shields.io/badge/Linux-FCC624?style=flat-square&logo=linux&logoColor=black) ![Arch Linux](https://img.shields.io/badge/Arch_Linux-1793D1?style=flat-square&logo=archlinux&logoColor=white) ![Android](https://img.shields.io/badge/Android-3DDC84?style=flat-square&logo=android&logoColor=black)\n\n</div>`,
        `> **升级前请备份重要数据。** 安装包请按系统和 CPU 架构选择。主密码尝试防护默认关闭，不会自动删除密码或云端数据库；云端部署者请先完成 [RLS 安全加固](https://github.com/${repository}/blob/main/docs/SUPABASE_SECURITY.md)。`,
        `## 本次更新\n\n${changes}`,
        `## 快速选择\n\n| 你的设备 | 推荐安装包 |\n| :--- | :--- |\n| Windows 常规电脑 | \`x64-setup.exe\`；32 位系统选 \`x86\`，ARM 设备选 \`arm64\` |\n| macOS | Apple 芯片选 \`aarch64.dmg\`，Intel 芯片选 \`x64.dmg\` |\n| Debian / Ubuntu | \`.deb\` |\n| Fedora / RHEL / openSUSE | \`.rpm\` |\n| Arch / EndeavourOS / Manjaro | 优先 \`.pkg.tar.zst\`，不要使用内置 Ubuntu 运行库的 AppImage |\n| Android | 通常选 \`arm64.apk\`；不确定时选 \`universal.apk\` |`,
    ];
    for (const [title, list, note] of [
        ['Windows', windows, '标准安装包需系统已有 WebView2；`webview2` 版在线安装运行时，`offlineInstaller` 版包含离线运行时。MSI 适合统一部署。'],
        ['macOS', mac, '下载后打开 DMG，将 WorkPlan 拖入 Applications。'],
        ['Linux', linux, 'AppImage 适合兼容的桌面发行版；需要系统软件包管理时使用 DEB / RPM。'],
        ['Arch Linux / 原生 Linux', arch, '使用系统 GTK / WebKit 运行库，避免 AppImage 内置库与滚动发行版冲突。Arch 包会由 pacman 管理依赖、桌面入口及图标。'],
        ['Android', android, '`universal` 包含所有架构、体积更大；`arm` 对应 ARMv7，`x86` / `x86_64` 主要用于部分设备与模拟器。'],
    ]) {
        if (list.length) sections.push(`## ${title}\n\n${note}\n\n${table(list)}`);
    }
    if (archPackage) sections.push(`### Arch 安装\n\n下载上方 Arch 安装包后，在文件所在目录运行：\n\n\`\`\`bash\nsudo pacman -U ./${archPackage.name}\n\`\`\`\n\n建议额外安装中文字体：\`sudo pacman -S --needed noto-fonts noto-fonts-cjk\`。${source.length ? `\n\n可重建的 PKGBUILD / .SRCINFO 源包：${source.map(asset => link(asset.name)).join(' · ')}（\`makepkg -si\`，不要以 root 运行）。` : ''}`);
    if (portable) sections.push(`### 原生 Linux 便携版\n\n需系统安装 WebKitGTK 4.1、GTK 3、librsvg 及 AppIndicator。Arch 可运行 \`sudo pacman -S --needed webkit2gtk-4.1 gtk3 librsvg libappindicator\`。\n\n\`\`\`bash\ntar -xzf ${portable.name}\n./WorkPlan-linux-x86_64/workplan\n\`\`\``);
    sections.push(`## 下载校验\n\n下载 ${link('SHA256SUMS')} 到安装包同一目录，验证 SHA-256：\n\n\`\`\`bash\n# Linux\nsha256sum --check --ignore-missing SHA256SUMS\n# macOS：计算后与 SHA256SUMS 对照\nshasum -a 256 <下载的安装包>\n\`\`\`\n\n\`\`\`powershell\n# Windows：计算后与 SHA256SUMS 对照\nGet-FileHash .\\<下载的安装包> -Algorithm SHA256\n\`\`\`\n\nSHA-256 可检测下载损坏，不等同于软件签名。\n\n---\n[使用说明](https://github.com/${repository}#readme) · [反馈问题](https://github.com/${repository}/issues) · [全部版本](https://github.com/${repository}/releases)`);
    return `${sections.join('\n\n')}\n`;
}

async function main() {
    const directory = resolve(process.argv[2] || 'artifacts');
    const version = (execFileSync('git', ['show', 'HEAD:VERSION'], { encoding: 'utf8' })).trim();
    const repository = process.env.GITHUB_REPOSITORY;
    const assets = await collectReleaseAssets(directory);
    if (!assets.length) throw new Error('No release assets were downloaded');
    const tags = execFileSync('git', ['tag', '--merged', 'HEAD', '--sort=-version:refname'], { encoding: 'utf8' }).trim().split(/\r?\n/);
    const previous = tags.find(tag => /^v\d+\.\d+\.\d+$/.test(tag) && tag !== `v${version}`);
    const commits = execFileSync('git', ['log', ...(previous ? [`${previous}..HEAD`] : ['-30']), '--no-merges', '--pretty=format:%s (%h)'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
    await writeReleaseChecksums(assets, join(directory, 'SHA256SUMS'));
    await writeFile('RELEASE_NOTES.md', renderReleaseNotes({ version, repository, assets, commits }));
    console.log(`Prepared ${assets.length} verified release assets for v${version}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
