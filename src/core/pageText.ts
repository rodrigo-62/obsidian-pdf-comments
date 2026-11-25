// A page's text and the mapping between it and PDF.js text items (SPEC §5.3, DECISIONS D0.2).
// Pure TypeScript.
//
// Page text = the `str` of every item of `page.getTextContent()` (default options), in order,
// with "\n" after each item that has `hasEOL`. Anchors store offsets into this string.
// Item indices are the text layer's `data-idx` values and Obsidian's `selection=` indices.

export interface TextItemLike {
	str: string;
	hasEOL?: boolean;
}

export interface PageText {
	text: string;
	/** Offset in `text` where item i starts. */
	starts: number[];
	/** Length of item i's `str`. */
	lengths: number[];
	/** Whether item i is followed by "\n". */
	eol: boolean[];
}

export function buildPageText(items: readonly TextItemLike[]): PageText {
	const starts: number[] = [];
	const lengths: number[] = [];
	const eol: boolean[] = [];
	let text = '';
	for (const it of items) {
		const str = typeof it.str === 'string' ? it.str : '';
		starts.push(text.length);
		lengths.push(str.length);
		eol.push(it.hasEOL === true);
		text += str;
		if (it.hasEOL) text += '\n';
	}
	return { text, starts, lengths, eol };
}

/** Page-text offset of a position inside an item (the offset is clamped to the item). Null if the index is out of range. */
export function itemToOffset(pt: PageText, index: number, offset: number): number | null {
	if (!Number.isInteger(index) || index < 0 || index >= pt.starts.length) return null;
	return pt.starts[index]! + Math.max(0, Math.min(offset, pt.lengths[index]!));
}

export interface ItemPos {
	index: number;
	offset: number;
}

/**
 * The item position of a page-text offset, on an item that has text (empty items have no span in
 * the text layer). `bias` decides offsets between items (a line break, an empty item): 'start'
 * moves forward to the next item's start (for the start of a range), 'end' moves back to the
 * previous item's end (for the end of a range). Null if there is no such item.
 */
export function offsetToItem(pt: PageText, offset: number, bias: 'start' | 'end'): ItemPos | null {
	const n = pt.starts.length;
	if (!n) return null;
	// Last item starting at or before the offset.
	let lo = 0;
	let hi = n - 1;
	let i = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (pt.starts[mid]! <= offset) {
			i = mid;
			lo = mid + 1;
		} else hi = mid - 1;
	}
	if (bias === 'start') {
		if (i >= 0 && pt.lengths[i]! > 0 && offset < pt.starts[i]! + pt.lengths[i]!) return { index: i, offset: offset - pt.starts[i]! };
		for (let j = i + 1; j < n; j++) if (pt.lengths[j]! > 0) return { index: j, offset: 0 };
		return null;
	}
	if (i >= 0 && pt.lengths[i]! > 0 && offset > pt.starts[i]! && offset <= pt.starts[i]! + pt.lengths[i]!) return { index: i, offset: offset - pt.starts[i]! };
	for (let j = offset > (pt.starts[i] ?? -1) ? i : i - 1; j >= 0; j--) {
		if (pt.lengths[j]! > 0 && pt.starts[j]! + pt.lengths[j]! <= offset) return { index: j, offset: pt.lengths[j]! };
	}
	return null;
}

/** Items overlapping [start, end), each with the overlapping part in item-local offsets. */
export function itemsInRange(pt: PageText, start: number, end: number): { index: number; from: number; to: number }[] {
	const out: { index: number; from: number; to: number }[] = [];
	for (let i = 0; i < pt.starts.length; i++) {
		const s = pt.starts[i]!;
		const e = s + pt.lengths[i]!;
		if (e <= start || s >= end || e === s) continue;
		out.push({ index: i, from: Math.max(start, s) - s, to: Math.min(end, e) - s });
	}
	return out;
}
