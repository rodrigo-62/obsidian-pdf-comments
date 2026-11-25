// Remembered position and zoom per PDF (SPEC §3.3). Pure TypeScript.
//
// Kept in plugin data, keyed by vault path, so reopening a PDF goes back to
// where it was. Bounded: the least recently used entries are dropped.

import { isZoomMode, type ZoomMode } from './zoom';

export interface FileViewState {
	/** 1-based page at the top of the view. */
	page: number;
	/** Point at the top-left of the view, in PDF units of that page (as PDF.js reports it). */
	top?: number;
	left?: number;
	zoom: ZoomMode;
	/** Last use, ms since epoch. */
	used: number;
}

export type ViewStateMap = Record<string, FileViewState>;

export const MAX_ENTRIES = 300;

function valid(s: unknown): s is FileViewState {
	if (!s || typeof s !== 'object') return false;
	const o = s as Record<string, unknown>;
	return Number.isInteger(o.page) && (o.page as number) >= 1 && isZoomMode(o.zoom) && typeof o.used === 'number';
}

/** Drops malformed entries (e.g. hand-edited data.json). */
export function sanitizeViewStates(raw: unknown): ViewStateMap {
	const out: ViewStateMap = {};
	if (!raw || typeof raw !== 'object') return out;
	for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (valid(v)) out[k] = v;
	return out;
}

export function putViewState(map: ViewStateMap, path: string, state: FileViewState, max = MAX_ENTRIES): ViewStateMap {
	const next: ViewStateMap = { ...map, [path]: state };
	const keys = Object.keys(next);
	if (keys.length > max) {
		keys.sort((a, b) => next[a]!.used - next[b]!.used);
		for (const k of keys.slice(0, keys.length - max)) delete next[k];
	}
	return next;
}

export function renameViewState(map: ViewStateMap, oldPath: string, newPath: string): ViewStateMap {
	if (!(oldPath in map) || oldPath === newPath) return map;
	const next: ViewStateMap = { ...map, [newPath]: map[oldPath]! };
	delete next[oldPath];
	return next;
}

export function deleteViewState(map: ViewStateMap, path: string): ViewStateMap {
	if (!(path in map)) return map;
	const next = { ...map };
	delete next[path];
	return next;
}
