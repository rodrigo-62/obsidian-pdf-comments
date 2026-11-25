// Copied from the Docs plugin (tests/model.test.ts, commit 13957fe).
import { describe, expect, it } from 'vitest';
import {
	addReply,
	buildTree,
	commentsInTimeOrder,
	createThread,
	defaultReplyParent,
	deleteComment,
	editComment,
	excerpt,
	flatView,
	nextCommentId,
	nowIso,
	orderThreads,
	prepareCommentMarkdown,
	setResolved,
	treeRows,
	type Thread,
} from '../../src/core/shared/model';

const T = (n: number) => `2026-11-1${n}T10:00:00Z`;

function thread(): Thread {
	let t = createThread('Light and Distance', 'The opening could say more about distance at sea.', T(0));
	t = addReply(t, 'a1', 'Second thought', T(1)); // a2 -> a1 (direct above: no chip)
	t = addReply(t, 'a2', 'Third, replying to second', T(2)); // a3 -> a2 (no chip)
	t = addReply(t, 'a1', 'Back to the first', T(3)); // a4 -> a1 (chip)
	return t;
}

describe('model basics', () => {
	it('formats timestamps with second precision', () => {
		expect(nowIso(new Date('2026-11-05T15:41:07.123Z'))).toBe('2026-11-05T15:41:07Z');
	});

	it('allocates comment ids a1, a2, …', () => {
		const t = thread();
		expect(t.comments.map((c) => c.id)).toEqual(['a1', 'a2', 'a3', 'a4']);
		expect(nextCommentId(t)).toBe('a5');
	});

	it('defaults a reply to the thread (its first comment)', () => {
		const t = thread();
		expect(defaultReplyParent(t)).toBe('a1');
		const t2 = addReply(t, null, 'plain reply', T(4));
		expect(t2.comments.at(-1)!.parent).toBe('a1');
		const t3 = addReply(t, 'missing', 'bad parent', T(4));
		expect(t3.comments.at(-1)!.parent).toBe('a1');
	});

	it('edits a comment and records the edit time', () => {
		const t = editComment(thread(), 'a2', 'edited', T(5));
		expect(t.comments[1]).toMatchObject({ body: 'edited', edited: T(5) });
	});

	it('deletes a reply and re-attaches its children', () => {
		const t = deleteComment(thread(), 'a2')!;
		expect(t.comments.map((c) => c.id)).toEqual(['a1', 'a3', 'a4']);
		expect(t.comments.find((c) => c.id === 'a3')!.parent).toBe('a1');
	});

	it('deleting the root comment deletes the thread', () => {
		expect(deleteComment(thread(), 'a1')).toBeNull();
	});

	it('resolves and re-opens', () => {
		const r = setResolved(thread(), true, T(6));
		expect(r).toMatchObject({ resolved: true, resolvedAt: T(6) });
		const o = setResolved(r, false);
		expect(o.resolved).toBe(false);
		expect('resolvedAt' in o).toBe(false);
	});

	it('orders comments by time, stable for ties', () => {
		const t = thread();
		t.comments.reverse();
		expect(commentsInTimeOrder(t).map((c) => c.id)).toEqual(['a1', 'a2', 'a3', 'a4']);
	});
});

describe('flatView parent chips', () => {
	it('shows a chip only for replies to a non-first comment that is not directly above', () => {
		let t = thread(); // a2->a1, a3->a2, a4->a1
		t = addReply(t, 'a2', 'back to the second', T(5)); // a5->a2: chip
		const items = flatView(t);
		expect(items.map((i) => i.chip?.parentId ?? null)).toEqual([null, null, null, null, 'a2']);
		expect(items[4]!.chip!.excerpt).toBe('Second thought');
	});
});

describe('tree view', () => {
	it('builds the reply tree', () => {
		const roots = buildTree(thread());
		expect(roots.length).toBe(1);
		expect(roots[0]!.children.map((c) => c.comment.id)).toEqual(['a2', 'a4']);
		expect(roots[0]!.children[0]!.children.map((c) => c.comment.id)).toEqual(['a3']);
	});

	it('caps indentation at 2 levels and adds a chip below that', () => {
		let t = thread();
		t = addReply(t, 'a3', 'depth 3', T(7)); // a5 -> a3 (depth 3)
		const rows = treeRows(t);
		const a5 = rows.find((r) => r.comment.id === 'a5')!;
		expect(a5.depth).toBe(3);
		expect(a5.indent).toBe(2);
		expect(a5.chip?.parentId).toBe('a3');
		expect(rows.map((r) => r.comment.id)).toEqual(['a1', 'a2', 'a3', 'a5', 'a4']);
	});

	it('collapses branches', () => {
		const rows = treeRows(thread(), new Set(['a2']));
		expect(rows.map((r) => r.comment.id)).toEqual(['a1', 'a2', 'a4']);
		expect(rows[1]).toMatchObject({ collapsed: true, hiddenCount: 1 });
	});

	it('survives dangling parents and cycles', () => {
		const t = thread();
		t.comments.push({ id: 'z1', parent: 'nope', created: T(8), body: 'dangling' });
		t.comments.push({ id: 'c1', parent: 'c2', created: T(8), body: 'cycle 1' });
		t.comments.push({ id: 'c2', parent: 'c1', created: T(8), body: 'cycle 2' });
		const rows = treeRows(t);
		expect(rows.length).toBe(t.comments.length);
		expect(rows.find((r) => r.comment.id === 'z1')!.depth).toBe(1);
	});
});

describe('helpers', () => {
	it('makes short excerpts', () => {
		expect(excerpt('**Bold** and `code`')).toBe('Bold and code');
		expect(excerpt('a'.repeat(100), 10)).toBe('aaaaaaaaaa…');
		expect(excerpt('---\nOne idea: start with a ship', 40)).toBe('One idea: start with a ship');
	});

	it('prepares --- separators so they are not setext headings', () => {
		expect(prepareCommentMarkdown('one\n---\ntwo')).toBe('one\n\n***\n\ntwo');
		// a leading --- must not open frontmatter (which would hide the text up to the next ---)
		expect(prepareCommentMarkdown('---\nI know\n---\nMaybe')).toBe('***\n\nI know\n\n***\n\nMaybe');
		expect(prepareCommentMarkdown('```\n---\n```')).toBe('```\n---\n```');
	});

	it('orders threads: anchored by position, then detached by creation', () => {
		const threads = {
			b: createThread('b', 'b', T(2)),
			a: createThread('a', 'a', T(1)),
			d2: createThread('d', 'd', T(3)),
			d1: createThread('d', 'd', T(0)),
		};
		const pos = new Map([
			['a', 50],
			['b', 10],
		]);
		expect(orderThreads(threads, pos)).toEqual({ anchored: ['b', 'a'], detached: ['d1', 'd2'] });
	});
});
