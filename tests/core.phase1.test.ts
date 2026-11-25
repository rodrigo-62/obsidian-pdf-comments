import { describe, expect, it } from 'vitest';
import { formatPdfSubpath, parsePdfSubpath } from '../src/core/subpath';
import { clampScale, isZoomMode, MAX_SCALE, MIN_SCALE, percentLabel, scaleFor, stepScale, wheelScale, ZOOM_PRESETS } from '../src/core/zoom';
import { deleteViewState, putViewState, renameViewState, sanitizeViewStates, type FileViewState } from '../src/core/viewStates';

describe('parsePdfSubpath', () => {
	it('reads page, Obsidian selection and comment', () => {
		expect(parsePdfSubpath('#page=3&selection=5,2,11,5&comment=k3f9')).toEqual({
			page: 3,
			selection: { beginIndex: 5, beginOffset: 2, endIndex: 11, endOffset: 5 },
			comment: 'k3f9',
		});
	});
	it('works without the leading #', () => {
		expect(parsePdfSubpath('page=12')).toEqual({ page: 12 });
	});
	it('ignores empty, malformed and unknown parts', () => {
		expect(parsePdfSubpath('')).toEqual({});
		expect(parsePdfSubpath(null)).toEqual({});
		expect(parsePdfSubpath('#page=0')).toEqual({});
		expect(parsePdfSubpath('#page=abc')).toEqual({});
		expect(parsePdfSubpath('#page=2.5')).toEqual({});
		expect(parsePdfSubpath('#page=2&selection=1,2,3')).toEqual({ page: 2 });
		expect(parsePdfSubpath('#page=2&selection=1,2,,4')).toEqual({ page: 2 });
		expect(parsePdfSubpath('#page=2&selection=1,-2,3,4')).toEqual({ page: 2 });
		expect(parsePdfSubpath('#page=2&zoom=auto&annotation=12R')).toEqual({ page: 2 });
		expect(parsePdfSubpath('#comment=bad id!')).toEqual({});
	});
	it('needs a page for a selection', () => {
		expect(parsePdfSubpath('#selection=1,2,3,4')).toEqual({});
	});
	it('round-trips through formatPdfSubpath', () => {
		for (const s of ['#page=3', '#page=3&selection=5,2,11,5', '#page=3&selection=0,0,0,4&comment=ab12', '#comment=zz9']) {
			expect(formatPdfSubpath(parsePdfSubpath(s))).toBe(s);
		}
		expect(formatPdfSubpath({})).toBe('');
	});
});

describe('zoom', () => {
	const fit = { availWidth: 840, availHeight: 1005, pageWidth: 400, pageHeight: 500 };
	it('fits width and page like PDF.js (paddings 40 / 5)', () => {
		expect(scaleFor('page-width', fit)).toBeCloseTo(2);
		expect(scaleFor('page-fit', fit)).toBeCloseTo(2);
		expect(scaleFor('page-fit', { ...fit, availHeight: 505 })).toBeCloseTo(1);
	});
	it('clamps, and falls back to 1 without page sizes', () => {
		expect(scaleFor(9, null)).toBe(MAX_SCALE);
		expect(scaleFor(0.01, null)).toBe(MIN_SCALE);
		expect(scaleFor('page-width', null)).toBe(1);
		expect(scaleFor('page-width', { ...fit, availWidth: 10 })).toBe(MIN_SCALE);
		expect(clampScale(NaN)).toBe(1);
	});
	it('steps through the presets', () => {
		expect(stepScale(1, 1)).toBe(1.1);
		expect(stepScale(1, -1)).toBe(0.9);
		expect(stepScale(1.03, 1)).toBe(1.1);
		expect(stepScale(1.03, -1)).toBe(1);
		expect(stepScale(ZOOM_PRESETS[ZOOM_PRESETS.length - 1]!, 1)).toBe(4);
		expect(stepScale(0.5, -1)).toBe(0.5);
		expect(stepScale(0.3, -1)).toBe(0.3);
	});
	it('zooms smoothly with the wheel, both ways, within bounds', () => {
		expect(wheelScale(1, -100)).toBeGreaterThan(1);
		expect(wheelScale(1, 100)).toBeLessThan(1);
		expect(wheelScale(1, 100) * wheelScale(1, -100)).toBeCloseTo(1);
		expect(wheelScale(MAX_SCALE, -100)).toBe(MAX_SCALE);
	});
	it('labels and validates', () => {
		expect(percentLabel(1.254)).toBe('125 %');
		expect(isZoomMode('page-fit')).toBe(true);
		expect(isZoomMode(1.5)).toBe(true);
		expect(isZoomMode('auto')).toBe(false);
		expect(isZoomMode(-1)).toBe(false);
	});
});

describe('view states', () => {
	const s = (used: number): FileViewState => ({ page: 1, zoom: 'page-width', used });
	it('keeps only the most recently used entries', () => {
		let m = {};
		for (let i = 0; i < 5; i++) m = putViewState(m, `f${i}.pdf`, s(i), 3);
		expect(Object.keys(m).sort()).toEqual(['f2.pdf', 'f3.pdf', 'f4.pdf']);
	});
	it('follows renames and deletes', () => {
		const m = { 'a.pdf': s(1) };
		expect(renameViewState(m, 'a.pdf', 'b/a.pdf')).toEqual({ 'b/a.pdf': s(1) });
		expect(renameViewState(m, 'x.pdf', 'y.pdf')).toBe(m);
		expect(deleteViewState(m, 'a.pdf')).toEqual({});
	});
	it('drops malformed entries', () => {
		expect(sanitizeViewStates({ ok: { page: 2, zoom: 1.5, used: 3 }, bad: { page: 0, zoom: 1, used: 1 }, worse: 'x', zoomless: { page: 1, used: 1 } })).toEqual({
			ok: { page: 2, zoom: 1.5, used: 3 },
		});
		expect(sanitizeViewStates(null)).toEqual({});
	});
});

describe('wheel zoom speed', () => {
	it('changes about 10 % per mouse notch', () => {
		expect(wheelScale(1, -100)).toBeCloseTo(1.105, 2);
		expect(wheelScale(1, 100)).toBeCloseTo(0.905, 2);
	});
});
