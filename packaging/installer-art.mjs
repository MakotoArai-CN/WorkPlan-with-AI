import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Deterministic vector-style artwork encoded as 24-bit BMP for NSIS.
// The installer itself keeps native controls, accessibility and language text.
export function installerBitmap(width, height, sidebar = false) {
    const scale = 3, stride = Math.ceil(width * 3 / 4) * 4;
    const bitmap = Buffer.alloc(54 + stride * height);
    bitmap.write('BM'); bitmap.writeUInt32LE(bitmap.length, 2); bitmap.writeUInt32LE(54, 10);
    bitmap.writeUInt32LE(40, 14); bitmap.writeInt32LE(width, 18); bitmap.writeInt32LE(height, 22);
    bitmap.writeUInt16LE(1, 26); bitmap.writeUInt16LE(24, 28); bitmap.writeUInt32LE(stride * height, 34);
    const centerX = sidebar ? 82 : 111, centerY = sidebar ? 87 : 28, size = sidebar ? 68 : 37;
    const line = (x, y, ax, ay, bx, by, thickness) => {
        const dot = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
        return Math.hypot(x - ax - dot * (bx - ax), y - ay - dot * (by - ay)) < thickness;
    };
    function pixel(x, y) {
        const glow = Math.max(0, 1 - Math.hypot((x - width * .7) / width, (y - height * .18) / height));
        let rgb = sidebar ? [250, 247 - glow * 15, 250 - glow * 6] : [255, 255, 255];
        if (sidebar && (Math.hypot(x - 160, y - 288) < 76 || Math.hypot(x + 50, y - 286) < 102)) rgb = [247, 225, 235];
        const dx = Math.abs(x - centerX) - size / 2 + size * .28;
        const dy = Math.abs(y - centerY) - size / 2 + size * .28;
        const inside = Math.hypot(Math.max(0, dx), Math.max(0, dy)) + Math.min(0, Math.max(dx, dy)) < size * .28;
        if (inside) rgb = [244 - (y - centerY) * .15, 57, 116 + (x - centerX) * .2];
        const u = (x - centerX) / size, v = (y - centerY) / size;
        if (inside && (line(u, v, -.23, -.24, .22, -.24, .026) || line(u, v, -.23, -.24, -.23, .16, .026)
            || line(u, v, .22, -.24, .22, .23, .026) || line(u, v, -.04, .23, .22, .23, .026)
            || line(u, v, -.21, .07, -.08, .19, .032) || line(u, v, -.08, .19, .09, -.03, .032))) rgb = [255, 255, 255];
        if (sidebar && y > 149 && y < 151 && x > 37 && x < 127) rgb = [233, 165, 190];
        return rgb;
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const sum = [0, 0, 0];
        for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
            const rgb = pixel(x + (sx + .5) / scale, y + (sy + .5) / scale);
            rgb.forEach((value, index) => sum[index] += value);
        }
        const offset = 54 + (height - y - 1) * stride + x * 3;
        sum.reverse().forEach((value, index) => bitmap[offset + index] = Math.round(value / scale ** 2));
    }
    return bitmap;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const destination = resolve('src-tauri/installer-art'); mkdirSync(destination, { recursive: true });
    for (const [name, width, height, sidebar] of [['header.bmp', 150, 57, false], ['sidebar.bmp', 164, 314, true]]) {
        const path = resolve(destination, name); mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, installerBitmap(width, height, sidebar));
    }
}
