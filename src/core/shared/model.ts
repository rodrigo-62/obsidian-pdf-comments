// Copied from the Docs plugin (src/core/model.ts, commit 13957fe, v1.2.0). Keep in sync by hand (SPEC §8);
// "SPEC §" references below are to the Docs spec.

// Comment and thread model, plus tree helpers. Pure TypeScript.
//
// Threads are stored as a tree (every comment has a `parent`) and shown flat by
// default: time order, with a "↳ re:" chip on a reply whose parent is not the
// comment directly above it (SPEC §5.5).

export interface Comment {
	id: string;
	/** Id of the comment this replies to; null for the thread's root comment. */
	parent: string | null;
	created: string;
	edited?: string;
	body: string;
	[extra: string]: unknown;
}

export interface Thread {
	/** Cached copy of the anchored text (used for orphans and export). */
	quote: string;
	created: string;
	resolved: boolean;
	resolvedAt?: string;
	comments: Comment[];
	[extra: string]: unknown;
}

export type Threads = Record<string, Thread>;

/** ISO-8601 UTC timestamp with second precision, e.g. 2026-11-05T15:41:00Z. */
export function nowIso(date: Date = new Date()): string {
	return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Next free comment id within a thread: a1, a2, … (max + 1, never reused while higher ids exist). */
export function nextCommentId(thread: Thread): string {
	let max = 0;
	for (const c of thread.comments) {
		const m = /^a(\d+)$/.exec(c.id);
		if (m) max = Math.max(max, Number(m[1]));
	}
	let n = max + 1;
	const ids = new Set(thread.comments.map((c) => c.id));
	while (ids.has('a' + n)) n++;
	return 'a' + n;
}

export function createThread(quote: string, body: string, now: string = nowIso()): Thread {
	return {
		quote,
		created: now,
		resolved: false,
		comments: [{ id: 'a1', parent: null, created: now, body }],
	};
}

export function rootComment(thread: Thread): Comment | undefined {
	return thread.comments.find((c) => c.parent === null) ?? thread.comments[0];
}

/** Comments sorted by creation time (stable: ties keep array order). */
export function commentsInTimeOrder(thread: Thread): Comment[] {
	return thread.comments
		.map((c, i) => ({ c, i }))
		.sort((a, b) => (a.c.created < b.c.created ? -1 : a.c.created > b.c.created ? 1 : a.i - b.i))
		.map((x) => x.c);
}

/**
 * The parent a plain "Reply" uses: the thread's first comment, i.e. a reply to
 * the thread as a whole (as in Google Docs). Replies to a specific comment are
 * made explicitly with that comment's reply button.
 */
export function defaultReplyParent(thread: Thread): string | null {
	return rootComment(thread)?.id ?? null;
}

export function addReply(thread: Thread, parentId: string | null, body: string, now: string = nowIso()): Thread {
	const parent = parentId && thread.comments.some((c) => c.id === parentId) ? parentId : defaultReplyParent(thread);
	const reply: Comment = { id: nextCommentId(thread), parent, created: now, body };
	return { ...thread, comments: [...thread.comments, reply] };
}

export function editComment(thread: Thread, commentId: string, body: string, now: string = nowIso()): Thread {
	return {
		...thread,
		comments: thread.comments.map((c) => (c.id === commentId ? { ...c, body, edited: now } : c)),
	};
}

/**
 * Delete one comment. Deleting the root comment deletes the whole thread
 * (returns null). Replies to a deleted comment are re-attached to its parent,
 * so no branch is lost.
 */
export function deleteComment(thread: Thread, commentId: string): Thread | null {
	const target = thread.comments.find((c) => c.id === commentId);
	if (!target) return thread;
	const root = rootComment(thread);
	if (root && root.id === commentId) return null;
	return {
		...thread,
		comments: thread.comments
			.filter((c) => c.id !== commentId)
			.map((c) => (c.parent === commentId ? { ...c, parent: target.parent } : c)),
	};
}

// --- Priority (DECISIONS F9.3) ---------------------------------------------
// A thread may carry "priority": "low" | "high" | "critical". Normal is the
// default and is never stored, so notes from before priorities existed, and
// threads nobody rated, stay byte-for-byte unchanged.

export const PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = { low: 'Low', normal: 'Normal', high: 'High', critical: 'Critical' };

/** A thread's priority. Missing or unrecognised values count as normal. */
export function threadPriority(thread: Thread): Priority {
	const p = thread.priority;
	return p === 'low' || p === 'high' || p === 'critical' ? p : 'normal';
}

/** Set a thread's priority (normal removes the field). Keeps "priority" before "comments" in the JSON. */
export function setPriority(thread: Thread, priority: Priority): Thread {
	const { comments, priority: _old, ...rest } = thread;
	return priority === 'normal' ? { ...rest, comments } : { ...rest, priority, comments };
}

export function setResolved(thread: Thread, resolved: boolean, now: string = nowIso()): Thread {
	const next: Thread = { ...thread, resolved };
	if (resolved) next.resolvedAt = now;
	else delete next.resolvedAt;
	return next;
}

/** A single-line excerpt for chips and lists: Markdown-ish markup removed, cut at a word boundary. */
export function excerpt(text: string, max = 40): string {
	const plain = text
		.replace(/^\s*---\s*$/gm, ' ')
		.replace(/[*_`~=#>]+/g, '')
		.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\s+/g, ' ')
		.trim();
	if (plain.length <= max) return plain;
	const cut = plain.slice(0, max);
	const sp = cut.lastIndexOf(' ');
	return (sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s.,;:!?-]+$/, '') + '…';
}

export interface ParentChip {
	parentId: string;
	excerpt: string;
}

export interface FlatItem {
	comment: Comment;
	/** Shown when the comment replies to something other than the comment directly above it. */
	chip: ParentChip | null;
}

/**
 * Default display: time order, with a parent chip on a reply that answers a
 * specific earlier comment other than the one directly above. Replies to the
 * first comment are replies to the thread itself and get no chip.
 */
export function flatView(thread: Thread, chipLength = 40): FlatItem[] {
	const ordered = commentsInTimeOrder(thread);
	const byId = new Map(thread.comments.map((c) => [c.id, c]));
	const rootId = rootComment(thread)?.id;
	return ordered.map((comment, i) => {
		const prev = i > 0 ? ordered[i - 1] : undefined;
		let chip: ParentChip | null = null;
		if (comment.parent !== null && comment.parent !== rootId && (!prev || comment.parent !== prev.id)) {
			const p = byId.get(comment.parent);
			if (p) chip = { parentId: p.id, excerpt: excerpt(p.body, chipLength) };
		}
		return { comment, chip };
	});
}

export interface TreeNode {
	comment: Comment;
	children: TreeNode[];
}

/**
 * Build the reply tree. Children are in time order. A comment whose parent is
 * missing (dangling) is attached to the root comment; extra parentless
 * comments become additional roots.
 */
export function buildTree(thread: Thread): TreeNode[] {
	const ordered = commentsInTimeOrder(thread);
	const root = rootComment(thread);
	const ids = new Set(ordered.map((c) => c.id));
	// Effective parents: dangling or self parents go to the root comment.
	const parentOf = new Map<string, string | null>();
	for (const c of ordered) {
		let p = c.parent;
		if (p !== null && (!ids.has(p) || p === c.id)) p = root && root.id !== c.id ? root.id : null;
		parentOf.set(c.id, p);
	}
	// Break cycles: a comment whose ancestor chain loops back is re-attached to the root.
	for (const c of ordered) {
		const seen = new Set<string>([c.id]);
		let p = parentOf.get(c.id) ?? null;
		while (p !== null) {
			if (seen.has(p)) {
				parentOf.set(c.id, root && root.id !== c.id ? root.id : null);
				break;
			}
			seen.add(p);
			p = parentOf.get(p) ?? null;
		}
	}
	const nodes = new Map<string, TreeNode>(ordered.map((c) => [c.id, { comment: c, children: [] }]));
	const roots: TreeNode[] = [];
	for (const c of ordered) {
		const node = nodes.get(c.id) as TreeNode;
		const p = parentOf.get(c.id) ?? null;
		if (p === null) roots.push(node);
		else (nodes.get(p) as TreeNode).children.push(node);
	}
	return roots;
}

export interface TreeRow {
	comment: Comment;
	/** Real depth in the tree (0 = root). */
	depth: number;
	/** Indentation level to display: depth capped at `maxIndent`. */
	indent: number;
	childCount: number;
	collapsed: boolean;
	/** Number of descendants hidden because this row is collapsed. */
	hiddenCount: number;
	/** Set when depth exceeds the indent cap, so the reader can still tell what is answered. */
	chip: ParentChip | null;
}

/** Tree view rows in depth-first order, honouring collapsed branches. Indentation is capped (SPEC §5.5: 2 levels). */
export function treeRows(thread: Thread, collapsed: ReadonlySet<string> = new Set(), maxIndent = 2, chipLength = 40): TreeRow[] {
	const rows: TreeRow[] = [];
	const count = (n: TreeNode): number => n.children.reduce((s, c) => s + 1 + count(c), 0);
	const walk = (n: TreeNode, depth: number, parent: TreeNode | null) => {
		const isCollapsed = collapsed.has(n.comment.id) && n.children.length > 0;
		rows.push({
			comment: n.comment,
			depth,
			indent: Math.min(depth, maxIndent),
			childCount: n.children.length,
			collapsed: isCollapsed,
			hiddenCount: isCollapsed ? count(n) : 0,
			chip: depth > maxIndent && parent ? { parentId: parent.comment.id, excerpt: excerpt(parent.comment.body, chipLength) } : null,
		});
		if (!isCollapsed) for (const c of n.children) walk(c, depth + 1, n);
	};
	for (const r of buildTree(thread)) walk(r, 0, null);
	return rows;
}

/**
 * Make `---` lines inside a comment body render as separators. Two Markdown
 * traps: a `---` line directly under text is a setext heading underline, and a
 * `---` on the first line opens YAML frontmatter, which Obsidian's renderer then
 * hides together with everything up to the next `---`. So separator lines are
 * rendered as `***` (the same horizontal rule, neither trap), with blank lines
 * around them. Only the display changes; the stored body keeps `---`.
 */
export function prepareCommentMarkdown(body: string): string {
	const lines = body.split('\n');
	const out: string[] = [];
	let inFence = false;
	for (const line of lines) {
		if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
		if (!inFence && /^\s*-{3,}\s*$/.test(line)) {
			if (out.length && out[out.length - 1]?.trim() !== '') out.push('');
			out.push('***');
			out.push('');
			continue;
		}
		out.push(line);
	}
	while (out.length && out[out.length - 1] === '') out.pop();
	return out.join('\n');
}

/** Order thread ids: anchored ones by anchor position, then detached ones by creation time. */
export function orderThreads(threads: Threads, anchorPos: ReadonlyMap<string, number>): { anchored: string[]; detached: string[] } {
	const anchored = Object.keys(threads)
		.filter((id) => anchorPos.has(id))
		.sort((a, b) => (anchorPos.get(a) as number) - (anchorPos.get(b) as number) || (a < b ? -1 : 1));
	const detached = Object.keys(threads)
		.filter((id) => !anchorPos.has(id))
		.sort((a, b) => {
			const ta = threads[a]?.created ?? '';
			const tb = threads[b]?.created ?? '';
			return ta < tb ? -1 : ta > tb ? 1 : a < b ? -1 : 1;
		});
	return { anchored, detached };
}
