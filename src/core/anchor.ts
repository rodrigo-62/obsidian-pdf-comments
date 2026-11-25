// Anchors: where a comment thread sits in the PDF (SPEC §5.2, §5.3). Pure TypeScript.
//
// An anchor is one segment per page it covers. A text segment has page-text offsets
// (pageText.ts) and the highlight rectangles; an area segment has rectangles only.
// Rectangles are [x1, y1, x2, y2] in PDF user space of that page (origin bottom-left,
// y up), so they don't depend on zoom. They are stored in reading order.

import { itemsInRange, type PageText, type TextItemLike } from './pageText';

export type Rect = [number, number, number, number];

export interface Segment {
	/** 1-based page number. */
	page: number;
	/** Page-text offsets of a text segment (absent for areas). */
	start?: number;
	end?: number;
	rects: Rect[];
	[extra: string]: unknown;
}

export interface Anchor {
	segments: Segment[];
	/** Text just before and after the quote (text-quote selector), for re-anchoring. */
	prefix?: string;
	suffix?: string;
	/** An area comment (rectangles only, no text). */
	area?: boolean;
	[extra: string]: unknown;
}

/** Characters of context kept before and after a quote. */
export const CONTEXT_LENGTH = 32;

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function isRect(r: unknown): r is Rect {
	return Array.isArray(r) && r.length === 4 && r.every(isNum);
}

function isSegment(s: unknown, area: boolean): s is Segment {
	if (!s || typeof s !== 'object') return false;
	const o = s as Record<string, unknown>;
	if (!Number.isInteger(o.page) || (o.page as number) < 1) return false;
	if (!Array.isArray(o.rects) || !o.rects.every(isRect)) return false;
	if (area) return o.rects.length > 0;
	return Number.isInteger(o.start) && Number.isInteger(o.end) && (o.start as number) >= 0 && (o.end as number) >= (o.start as number);
}

/** A stored anchor, if it is well-formed (malformed ones are kept in the file but not shown). */
export function validAnchor(raw: unknown): Anchor | null {
	if (!raw || typeof raw !== 'object') return null;
	const o = raw as Record<string, unknown>;
	const area = o.area === true;
	if (!Array.isArray(o.segments) || o.segments.length === 0) return null;
	if (!o.segments.every((s) => isSegment(s, area))) return null;
	return raw as Anchor;
}

// ---- Rectangles -------------------------------------------------------------

export function normalizeRect(r: Rect): Rect {
	return [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];
}

export function roundRect(r: Rect, digits = 1): Rect {
	const f = 10 ** digits;
	return r.map((v) => Math.round(v * f) / f) as Rect;
}

function union(a: Rect, b: Rect): Rect {
	return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

/**
 * Merges consecutive rectangles on the same line (vertical overlap of at least half the smaller
 * height, horizontal gap of at most `gapFactor` × that height) and drops empty ones.
 * Reading order is kept.
 */
export function mergeLineRects(rects: readonly Rect[], gapFactor = 0.6): Rect[] {
	const out: Rect[] = [];
	for (const raw of rects) {
		const r = normalizeRect(raw);
		if (r[2] - r[0] < 0.5 || r[3] - r[1] < 0.5) continue;
		const last = out[out.length - 1];
		if (last) {
			const h = Math.min(last[3] - last[1], r[3] - r[1]);
			const overlap = Math.min(last[3], r[3]) - Math.max(last[1], r[1]);
			const gap = Math.max(r[0] - last[2], last[0] - r[2]);
			if (overlap >= h / 2 && gap <= gapFactor * h) {
				out[out.length - 1] = union(last, r);
				continue;
			}
		}
		out.push(r);
	}
	return out;
}

/** An affine transform [a, b, c, d, e, f]: (x, y) → (a·x + c·y + e, b·x + d·y + f). */
export type Transform = [number, number, number, number, number, number];

export function applyTransform(t: Transform, x: number, y: number): [number, number] {
	return [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]];
}

export function applyInverseTransform(t: Transform, x: number, y: number): [number, number] {
	const det = t[0] * t[3] - t[1] * t[2];
	return [((x - t[4]) * t[3] - (y - t[5]) * t[2]) / det, ((y - t[5]) * t[0] - (x - t[4]) * t[1]) / det];
}

function boundsOf(points: [number, number][]): Rect {
	const xs = points.map((p) => p[0]);
	const ys = points.map((p) => p[1]);
	return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** A rectangle in page CSS pixels (left, top, right, bottom) → PDF user space, with the page viewport's transform. */
export function cssRectToPdf(left: number, top: number, right: number, bottom: number, viewport: Transform): Rect {
	return boundsOf([
		applyInverseTransform(viewport, left, top),
		applyInverseTransform(viewport, right, bottom),
		applyInverseTransform(viewport, left, bottom),
		applyInverseTransform(viewport, right, top),
	]);
}

/** A PDF rectangle → page CSS pixels { left, top, width, height }, with the page viewport's transform. */
export function pdfRectToCss(r: Rect, viewport: Transform): { left: number; top: number; width: number; height: number } {
	const b = boundsOf([applyTransform(viewport, r[0], r[1]), applyTransform(viewport, r[2], r[3]), applyTransform(viewport, r[0], r[3]), applyTransform(viewport, r[2], r[1])]);
	return { left: b[0], top: b[1], width: b[2] - b[0], height: b[3] - b[1] };
}

export interface TextItemGeom extends TextItemLike {
	/** PDF.js item transform: text direction (a, b), up (c, d), origin (e, f) on the baseline. */
	transform: number[];
	/** Advance width and font height, in PDF units. */
	width: number;
	height: number;
}

/**
 * Highlight rectangles for page-text range [start, end), computed from the text items' geometry
 * (used when there is no rendered text layer, e.g. after re-anchoring). Characters are assumed to
 * be equally wide within an item, and the box spans 0.2 of the font height below the baseline to
 * 0.8 above it, so this is an approximation of what a DOM selection gives.
 */
export function rectsFromItems(items: readonly TextItemGeom[], pt: PageText, start: number, end: number): Rect[] {
	const rects: Rect[] = [];
	for (const { index, from, to } of itemsInRange(pt, start, end)) {
		const it = items[index];
		const len = pt.lengths[index]!;
		if (!it || !Array.isArray(it.transform) || it.transform.length < 6 || len === 0) continue;
		const [a, b, c, d, e, f] = it.transform as [number, number, number, number, number, number];
		const ul = Math.hypot(a, b) || 1;
		const vl = Math.hypot(c, d) || 1;
		const [ux, uy] = [a / ul, b / ul];
		const [vx, vy] = [c / vl, d / vl];
		const h = it.height > 0 ? it.height : vl;
		const x0 = (it.width * from) / len;
		const x1 = (it.width * to) / len;
		const lo = -0.2 * h;
		const hi = 0.8 * h;
		const p = (along: number, up: number): [number, number] => [e + ux * along + vx * up, f + uy * along + vy * up];
		rects.push(boundsOf([p(x0, lo), p(x1, lo), p(x0, hi), p(x1, hi)]));
	}
	return mergeLineRects(rects);
}

// ---- Order ------------------------------------------------------------------

/** Where an anchor begins: its first page and the top-left of its first rectangle (PDF units, y up). */
export function anchorStart(a: Anchor): { page: number; top: number; left: number } {
	const s = a.segments[0]!;
	const r = s.rects[0];
	return { page: s.page, top: r ? r[3] : Infinity, left: r ? r[0] : 0 };
}

/** Reading order: page, then top to bottom, then left to right, then text offset. */
export function compareAnchors(a: Anchor, b: Anchor): number {
	const x = anchorStart(a);
	const y = anchorStart(b);
	if (x.page !== y.page) return x.page - y.page;
	if (Math.abs(x.top - y.top) > 1) return y.top - x.top;
	if (Math.abs(x.left - y.left) > 1) return x.left - y.left;
	return (a.segments[0]!.start ?? 0) - (b.segments[0]!.start ?? 0);
}

// ---- Quote and context ------------------------------------------------------

/** The text of a text anchor's segments (pages joined by a line break). Null if a page text is missing. */
export function segmentsText(segments: readonly Segment[], pageText: (page: number) => string | undefined): string | null {
	const parts: string[] = [];
	for (const s of segments) {
		const t = pageText(s.page);
		if (t === undefined || s.start === undefined || s.end === undefined) return null;
		parts.push(t.slice(s.start, s.end));
	}
	return parts.join('\n');
}

/** The text before the first segment and after the last one, on their pages (whitespace collapsed). */
export function contextOf(segments: readonly Segment[], pageText: (page: number) => string | undefined, length = CONTEXT_LENGTH): { prefix: string; suffix: string } {
	const first = segments[0];
	const last = segments[segments.length - 1];
	const squash = (s: string) => s.replace(/\s+/g, ' ');
	const before = first && first.start !== undefined ? (pageText(first.page) ?? '').slice(0, first.start) : '';
	const after = last && last.end !== undefined ? (pageText(last.page) ?? '').slice(last.end) : '';
	return { prefix: squash(before).slice(-length), suffix: squash(after).slice(0, length) };
}
