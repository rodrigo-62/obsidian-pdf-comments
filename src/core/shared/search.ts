// Copied from the Docs plugin (src/core/search.ts, commit 13957fe, v1.2.0): the two helpers that
// don't depend on Markdown markers. Keep in sync by hand (SPEC §8).

import type { Thread } from './model';

function queryRegex(query: string, flags: string): RegExp {
	return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
}

/** Ids of a thread's comments whose body contains `query` (plain text, case-insensitive). */
export function matchingComments(thread: Thread, query: string): string[] {
	if (!query) return [];
	const re = queryRegex(query, 'i');
	return thread.comments.filter((c) => re.test(c.body)).map((c) => c.id);
}

/** [start, end) of each occurrence of `query` in `text` (plain text, case-insensitive, non-overlapping). */
export function findOccurrences(text: string, query: string): [number, number][] {
	if (!query) return [];
	const out: [number, number][] = [];
	for (const m of text.matchAll(queryRegex(query, 'gi'))) out.push([m.index, m.index + m[0].length]);
	return out;
}
