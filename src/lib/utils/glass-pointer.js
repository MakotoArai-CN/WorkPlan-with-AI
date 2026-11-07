/**
 * Pointer-driven specular highlight for the liquid glass theme.
 *
 * The upstream library ray-marches a multi-light Blinn-Phong specular in a
 * fragment shader. Doing this in CSS is a single shared light: one pair of
 * custom properties on :root, consumed by every glass panel's background
 * gradient. It costs one rAF per pointer move and no extra layers.
 */
export function installGlassPointer(target = typeof document !== 'undefined' ? document.documentElement : null) {
    if (!target || typeof window === 'undefined') return () => {};
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return () => {};

    let frame = 0;
    let pendingX = 0;
    let pendingY = 0;

    const apply = () => {
        frame = 0;
        target.style.setProperty('--glass-pointer-x', `${pendingX.toFixed(1)}px`);
        target.style.setProperty('--glass-pointer-y', `${pendingY.toFixed(1)}px`);
    };

    const onMove = (event) => {
        if (target.dataset.theme !== 'liquidglass') return;
        pendingX = event.clientX;
        pendingY = event.clientY;
        if (!frame) frame = window.requestAnimationFrame(apply);
    };

    window.addEventListener('pointermove', onMove, { passive: true });

    return () => {
        window.removeEventListener('pointermove', onMove);
        if (frame) window.cancelAnimationFrame(frame);
    };
}
