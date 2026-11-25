// Copied from the Docs plugin (src/core/layout.ts, commit 13957fe, v1.2.0). Keep in sync by hand (SPEC §8);
// "SPEC §" references below are to the Docs spec.

// Margin card layout (SPEC §5.2). Pure TypeScript.
//
// Each card wants its top edge level with the top of its anchor. Cards are
// sorted by anchor position and pushed down to avoid overlap. If a card is
// active, it always gets exactly its ideal position, and the cards before it
// are pushed *up* (and the ones after it down), as in Google Docs, even if
// that pushes some of them off the top for a while.

export interface CardBox {
	id: string;
	/** Ideal top (anchor top), in px. */
	ideal: number;
	height: number;
	/** Tie-breaker for equal ideals (document order of the anchor start). */
	order?: number;
}

export interface LayoutOptions {
	gap?: number;
	activeId?: string | null;
	/** Without an active card, cards don't start above this (e.g. the top of the document). */
	minTop?: number;
}

/** Returns the top of every card, keyed by id. */
export function layoutCards(cards: CardBox[], opts: LayoutOptions = {}): Map<string, number> {
	const gap = opts.gap ?? 8;
	const minTop = opts.minTop ?? -Infinity;
	const sorted = cards
		.map((c, i) => ({ ...c, order: c.order ?? i }))
		.sort((a, b) => a.ideal - b.ideal || a.order - b.order);
	const tops = new Array<number>(sorted.length);
	const k = opts.activeId ? sorted.findIndex((c) => c.id === opts.activeId) : -1;

	const forward = (from: number, floor: number) => {
		let cursor = floor;
		for (let i = from; i < sorted.length; i++) {
			const c = sorted[i]!;
			const t = Math.max(c.ideal, cursor);
			tops[i] = t;
			cursor = t + c.height + gap;
		}
	};

	if (k === -1) {
		forward(0, minTop);
	} else {
		const active = sorted[k]!;
		tops[k] = active.ideal;
		// cards after the active one: pushed down
		forward(k + 1, tops[k] + active.height + gap);
		// cards before it: pushed up
		let ceiling = tops[k] - gap;
		for (let i = k - 1; i >= 0; i--) {
			const c = sorted[i]!;
			const t = Math.min(c.ideal, ceiling - c.height);
			tops[i] = t;
			ceiling = t - gap;
		}
	}
	const out = new Map<string, number>();
	sorted.forEach((c, i) => out.set(c.id, tops[i]!));
	return out;
}
