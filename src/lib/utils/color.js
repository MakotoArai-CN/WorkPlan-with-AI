// CSS Color 4 conversion used by the PDF/image exporters.
//
// html2canvas 1.x cannot parse `oklch()`, which Tailwind v4 emits for every
// palette colour, so exported reports would render black or transparent.
// Keep this module DOM-free so it can be unit tested under Bun.

function parseOklchComponent(value, percentScale = 1) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return 0;
    if (trimmed.endsWith('%')) {
        return (parseFloat(trimmed) / 100) * percentScale;
    }
    return parseFloat(trimmed) || 0;
}

function gammaEncode(value) {
    const clamped = Math.min(1, Math.max(0, value));
    const encoded = clamped <= 0.0031308
        ? 12.92 * clamped
        : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, encoded)) * 255);
}

/** Convert an `oklch(L C H[ / A])` colour to `rgb()`/`rgba()`. */
export function oklchToRgb(color) {
    const match = String(color).match(
        /^oklch\(\s*([+-]?[\d.]+%?)\s+([+-]?[\d.]+%?)\s+([+-]?[\d.]+)(deg|rad|turn)?\s*(?:\/\s*([+-]?[\d.]+%?))?\s*\)$/i
    );
    if (!match) return color;

    const lightness = parseOklchComponent(match[1]);
    const chroma = parseOklchComponent(match[2], 0.4);
    let hue = parseFloat(match[3]) || 0;
    const hueUnit = (match[4] || '').toLowerCase();
    if (hueUnit === 'rad') hue = (hue * 180) / Math.PI;
    if (hueUnit === 'turn') hue *= 360;
    const hueRad = (hue * Math.PI) / 180;

    const a = chroma * Math.cos(hueRad);
    const b = chroma * Math.sin(hueRad);

    const lPrime = lightness + 0.3963377774 * a + 0.2158037573 * b;
    const mPrime = lightness - 0.1055613458 * a - 0.0638541728 * b;
    const sPrime = lightness - 0.0894841775 * a - 1.2914855480 * b;

    const l = lPrime ** 3;
    const m = mPrime ** 3;
    const s = sPrime ** 3;

    const red = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const green = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const blue = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

    const alpha = match[5]
        ? Math.min(1, Math.max(0, parseOklchComponent(match[5])))
        : 1;
    const channels = `${gammaEncode(red)}, ${gammaEncode(green)}, ${gammaEncode(blue)}`;
    return alpha < 1 ? `rgba(${channels}, ${Number(alpha.toFixed(3))})` : `rgb(${channels})`;
}

/** Replace every oklch() occurrence in a CSS value (gradients included). */
export function convertOklchColorsInValue(value) {
    if (typeof value !== 'string' || !value.toLowerCase().includes('oklch(')) {
        return value;
    }
    return value.replace(
        /oklch\(\s*[+-]?[\d.]+%?\s+[+-]?[\d.]+%?\s+[+-]?[\d.]+(?:deg|rad|turn)?\s*(?:\/\s*[+-]?[\d.]+%?)?\s*\)/gi,
        (match) => oklchToRgb(match)
    );
}
