export function selectionIndicatorBounds(container, target) {
    const empty = { left: 0, top: 0, width: 0, height: 0, ready: false };
    if (!container || !target) return empty;
    const parent = container.getBoundingClientRect();
    const button = target.getBoundingClientRect();
    if (!(parent.width > 0 && parent.height > 0 && button.width > 0 && button.height > 0)) return empty;
    // Keep fractional CSS pixels and compensate for ancestor scale/zoom. Offset
    // coordinates can be rounded or relative to a different positioning parent.
    const scaleX = container.offsetWidth / parent.width || 1;
    const scaleY = container.offsetHeight / parent.height || 1;
    const maxWidth = container.clientWidth || parent.width * scaleX;
    const maxHeight = container.clientHeight || parent.height * scaleY;
    const left = Math.max(0, Math.min(maxWidth, (button.left - parent.left) * scaleX - (container.clientLeft || 0)));
    const top = Math.max(0, Math.min(maxHeight, (button.top - parent.top) * scaleY - (container.clientTop || 0)));
    return {
        left, top,
        width: Math.max(0, Math.min(button.width * scaleX, maxWidth - left)),
        height: Math.max(0, Math.min(button.height * scaleY, maxHeight - top)),
        ready: true
    };
}
