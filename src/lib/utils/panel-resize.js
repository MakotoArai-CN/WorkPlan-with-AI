export const DEFAULT_DETAIL_WIDTH = 350;
export const DETAIL_WIDTH_KEY = 'workplan_detail_panel_width';
export const DEFAULT_NOTES_WIDTH = 288;
export const NOTES_WIDTH_KEY = 'workplan_notes_panel_width';

const MIN_DETAIL_WIDTH = 280;
const MAX_DETAIL_WIDTH = 720;
const MIN_WORKSPACE_WIDTH = 360;

export function detailPanelLayout(availableWidth, preferredWidth = DEFAULT_DETAIL_WIDTH) {
    const available = Math.max(0, Math.floor(Number(availableWidth) || 0));
    const overlay = available < MIN_WORKSPACE_WIDTH + MIN_DETAIL_WIDTH;
    const min = Math.min(MIN_DETAIL_WIDTH, available);
    const max = Math.max(min, Math.min(MAX_DETAIL_WIDTH, overlay ? available - 24 : available - MIN_WORKSPACE_WIDTH));
    const preferred = Number.isFinite(Number(preferredWidth)) ? Number(preferredWidth) : DEFAULT_DETAIL_WIDTH;
    return { min, max, width: Math.round(Math.max(min, Math.min(max, preferred))), overlay };
}

export function notesPanelLayout(availableWidth, preferredWidth = DEFAULT_NOTES_WIDTH) {
    const available = Math.max(0, Math.floor(Number(availableWidth) || 0));
    const min = Math.min(200, Math.floor(available / 2));
    const max = Math.max(min, Math.min(480, available - 360));
    const preferred = Number.isFinite(Number(preferredWidth)) ? Number(preferredWidth) : DEFAULT_NOTES_WIDTH;
    return { min, max, width: Math.round(Math.max(min, Math.min(max, preferred))) };
}

export function detailWidthFromKey(key, width, min, max, edge = 'left') {
    const direction = edge === 'right' ? -1 : 1;
    const next = key === 'ArrowLeft' ? width + 16 * direction : key === 'ArrowRight' ? width - 16 * direction
        : key === 'Home' ? min : key === 'End' ? max : null;
    return next === null ? null : Math.max(min, Math.min(max, next));
}
