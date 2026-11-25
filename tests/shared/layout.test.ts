// Copied from the Docs plugin (tests/layout.test.ts, commit 13957fe).
import { describe, expect, it } from 'vitest';
import { layoutCards } from '../../src/core/shared/layout';

const obj = (m: Map<string, number>) => Object.fromEntries(m);

describe('layoutCards', () => {
	it('places cards at their ideal position when there is room', () => {
		expect(obj(layoutCards([{ id: 'a', ideal: 0, height: 50 }, { id: 'b', ideal: 100, height: 50 }]))).toEqual({ a: 0, b: 100 });
	});

	it('pushes overlapping cards down, in anchor order', () => {
		const m = layoutCards(
			[
				{ id: 'b', ideal: 20, height: 50 },
				{ id: 'a', ideal: 10, height: 50 },
				{ id: 'c', ideal: 30, height: 50 },
			],
			{ gap: 10 },
		);
		expect(obj(m)).toEqual({ a: 10, b: 70, c: 130 });
	});

	it('gives the active card its ideal position and pushes earlier cards up', () => {
		const m = layoutCards(
			[
				{ id: 'a', ideal: 100, height: 50 },
				{ id: 'b', ideal: 110, height: 50 },
				{ id: 'c', ideal: 120, height: 50 },
			],
			{ gap: 10, activeId: 'b' },
		);
		expect(obj(m)).toEqual({ a: 50, b: 110, c: 170 });
	});

	it('the active card stays at its anchor even if earlier cards go off the top', () => {
		const m = layoutCards(
			[
				{ id: 'a', ideal: 0, height: 50 },
				{ id: 'b', ideal: 10, height: 50 },
			],
			{ gap: 10, activeId: 'b', minTop: 0 },
		);
		expect(obj(m)).toEqual({ a: -50, b: 10 });
	});

	it('without an active card, nothing starts above minTop', () => {
		const m = layoutCards([{ id: 'a', ideal: -30, height: 50 }], { gap: 10, minTop: 0 });
		expect(obj(m)).toEqual({ a: 0 });
	});

	it('keeps document order for equal ideals', () => {
		const m = layoutCards(
			[
				{ id: 'x', ideal: 0, height: 10, order: 2 },
				{ id: 'y', ideal: 0, height: 10, order: 1 },
			],
			{ gap: 0 },
		);
		expect(obj(m)).toEqual({ y: 0, x: 10 });
	});

	it('never overlaps (random check)', () => {
		let seed = 7;
		const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
		for (let run = 0; run < 50; run++) {
			const cards = Array.from({ length: 30 }, (_, i) => ({ id: 'c' + i, ideal: Math.floor(rnd() * 2000), height: 20 + Math.floor(rnd() * 120) }));
			const active = rnd() < 0.5 ? cards[Math.floor(rnd() * cards.length)]!.id : null;
			const m = layoutCards(cards, { gap: 8, activeId: active, minTop: 0 });
			const placed = cards.map((c) => ({ ...c, top: m.get(c.id)! })).sort((a, b) => a.top - b.top);
			for (let i = 1; i < placed.length; i++) expect(placed[i]!.top).toBeGreaterThanOrEqual(placed[i - 1]!.top + placed[i - 1]!.height + 8 - 1e-9);
			if (active) expect(m.get(active)).toBe(cards.find((c) => c.id === active)!.ideal);
			else expect(placed[0]!.top).toBeGreaterThanOrEqual(0);
		}
	});
});
