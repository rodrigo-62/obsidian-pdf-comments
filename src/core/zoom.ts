// Zoom modes and scale arithmetic (SPEC §3.3). Pure TypeScript.
//
// A scale of 1 is PDF.js's 100 % (CSS pixels = PDF points × 96/72). "Fit width"
// and "fit page" are computed by us rather than by PDF.js, because the width
// available to the pages is the pane minus the comment margin.

export type ZoomMode = 'page-width' | 'page-fit' | number;

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 5;
/** Steps offered in the zoom menu and used by zoom in / zoom out. */
export const ZOOM_PRESETS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];

/** Same paddings as PDF.js uses for its own fit modes (SCROLLBAR_PADDING, VERTICAL_PADDING). */
export const H_PADDING = 40;
export const V_PADDING = 5;

export function clampScale(scale: number): number {
	if (!Number.isFinite(scale)) return 1;
	return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function isZoomMode(v: unknown): v is ZoomMode {
	return v === 'page-width' || v === 'page-fit' || (typeof v === 'number' && Number.isFinite(v) && v > 0);
}

export interface FitInput {
	/** Width and height available to the pages, in CSS px (pane minus margin). */
	availWidth: number;
	availHeight: number;
	/** Size of the current page at scale 1, in CSS px. */
	pageWidth: number;
	pageHeight: number;
}

/** The scale for a zoom mode. Numeric modes are clamped; fit modes too. */
export function scaleFor(mode: ZoomMode, fit: FitInput | null): number {
	if (typeof mode === 'number') return clampScale(mode);
	if (!fit || fit.pageWidth <= 0 || fit.pageHeight <= 0) return 1;
	const w = (fit.availWidth - H_PADDING) / fit.pageWidth;
	if (mode === 'page-width') return clampScale(w);
	const h = (fit.availHeight - V_PADDING) / fit.pageHeight;
	return clampScale(Math.min(w, h));
}

/** Next preset above (dir = 1) or below (dir = -1) the current scale. */
export function stepScale(current: number, dir: 1 | -1): number {
	const eps = 0.005;
	if (dir > 0) return ZOOM_PRESETS.find((p) => p > current + eps) ?? clampScale(Math.max(current, ZOOM_PRESETS[ZOOM_PRESETS.length - 1]!));
	for (let i = ZOOM_PRESETS.length - 1; i >= 0; i--) if (ZOOM_PRESETS[i]! < current - eps) return ZOOM_PRESETS[i]!;
	return clampScale(Math.min(current, ZOOM_PRESETS[0]!));
}

/** Scale after a Ctrl+wheel event: proportional to the wheel distance (one mouse notch, 100, is about 10 %; trackpad pinches send small deltas). */
export function wheelScale(current: number, deltaY: number): number {
	const d = Math.max(-100, Math.min(100, deltaY));
	return clampScale(current * Math.exp(-d / 1000));
}

export function percentLabel(scale: number): string {
	return `${Math.round(scale * 100)} %`;
}
