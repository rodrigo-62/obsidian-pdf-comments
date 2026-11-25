// Copied from the Docs plugin (src/core/textFormat.ts, commit 13957fe, v1.2.0). Keep in sync by hand (SPEC §8);
// "SPEC §" references below are to the Docs spec.

// Markdown formatting for the comment box (DECISIONS F9.1): Ctrl+B and the like
// act on the box's own text instead of the note.

/** Replace [from, to) with `insert`, then select [selStart, selEnd). */
export interface TextEdit {
	from: number;
	to: number;
	insert: string;
	selStart: number;
	selEnd: number;
}

/** Toggle a symmetric marker (`**`, `*`, `~~`, `==`, `` ` ``) around the selection [s, e). */
export function toggleWrap(text: string, s: number, e: number, marker: string): TextEdit {
	const m = marker.length;
	const sel = text.slice(s, e);
	// Markers just outside the selection: remove them.
	if (s >= m && text.slice(s - m, s) === marker && text.slice(e, e + m) === marker) {
		return { from: s - m, to: e + m, insert: sel, selStart: s - m, selEnd: e - m };
	}
	// The selection itself is wrapped: remove the markers inside it.
	if (sel.length >= 2 * m && sel.startsWith(marker) && sel.endsWith(marker)) {
		const inner = sel.slice(m, sel.length - m);
		return { from: s, to: e, insert: inner, selStart: s, selEnd: s + inner.length };
	}
	return { from: s, to: e, insert: marker + sel + marker, selStart: s + m, selEnd: e + m };
}

/** Insert a Markdown link: `[selection](|)`, or `[|]()` with nothing selected. */
export function insertLink(text: string, s: number, e: number): TextEdit {
	const sel = text.slice(s, e);
	if (!sel) return { from: s, to: e, insert: '[]()', selStart: s + 1, selEnd: s + 1 };
	if (/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(sel)) {
		return { from: s, to: e, insert: `[](${sel})`, selStart: s + 1, selEnd: s + 1 };
	}
	const caret = s + sel.length + 3;
	return { from: s, to: e, insert: `[${sel}]()`, selStart: caret, selEnd: caret };
}
