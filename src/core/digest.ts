// The readable part of a comment note (SPEC §5.2): generated from the threads on every save,
// never parsed back. Pure TypeScript, deterministic (dates in UTC, like the Docs export).
//
//   > Generated from the comments on [[Papers/Smith 2021.pdf]]. …
//
//   ## Page 12
//
//   > the quoted passage
//
//   [[Papers/Smith 2021.pdf#page=12&comment=k3f9|Open]] · High priority
//
//   - 2026-11-25 15:41 · first comment
//     - 2026-11-25 16:02 · a reply to it
//
//   ## Detached
//   …

import { compareAnchors } from './anchor';
import { buildTree, PRIORITY_LABELS, threadPriority, type TreeNode } from './shared/model';
import { threadAnchor, type PdfThread, type PdfThreads } from './sidecar';
import { formatPdfSubpath } from './subpath';

/** "2026-11-25 15:41" in UTC (as the Docs plugin writes dates). */
export function formatDate(iso: string): string {
	const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
	if (!m) return iso;
	const d = new Date(iso);
	if (isNaN(d.getTime())) return `${m[1]} ${m[2]}`;
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** Keeps generated text from ending the data block, hiding text (HTML comments) or making links. */
function safe(s: string): string {
	return s.replace(/<!--/g, '&lt;!--').replace(/-->/g, '--&gt;').replace(/\[\[/g, '\\[\\[').replace(/\]\]/g, '\\]\\]');
}

function quoteBlock(t: PdfThread, area: boolean): string {
	if (area) return '> *[area]*';
	const q = t.quote.trim();
	if (!q) return '> *(no text)*';
	return q
		.split(/\r?\n/)
		.map((l) => `> ${safe(l.replace(/^(\s*)([#>])/, '$1\\$2'))}`.trimEnd())
		.join('\n');
}

function renderComments(nodes: TreeNode[], depth: number): string[] {
	const out: string[] = [];
	const pad = '  '.repeat(depth);
	for (const n of nodes) {
		const lines = safe(n.comment.body.trim()).split(/\r?\n/);
		const edited = n.comment.edited ? ' (edited)' : '';
		out.push(`${pad}- ${formatDate(n.comment.created)}${edited} · ${lines[0] ?? ''}`.trimEnd());
		for (const l of lines.slice(1)) out.push(l.trim() ? `${pad}  ${l}` : '');
		out.push(...renderComments(n.children, depth + 1));
	}
	return out;
}

function renderThread(pdfPath: string, id: string, t: PdfThread): string {
	const anchor = threadAnchor(t);
	const page = anchor?.segments[0]?.page;
	const link = `[[${pdfPath}${formatPdfSubpath({ page, comment: id })}|Open]]`;
	const tags: string[] = [];
	const prio = threadPriority(t);
	if (prio !== 'normal') tags.push(`${PRIORITY_LABELS[prio]} priority`);
	if (t.resolved) tags.push('Resolved');
	if (anchor && anchor.segments.length > 1) tags.push(`pages ${anchor.segments[0]!.page}–${anchor.segments[anchor.segments.length - 1]!.page}`);
	return [quoteBlock(t, anchor?.area === true), '', [link, ...tags].join(' · '), '', ...renderComments(buildTree(t), 0)].join('\n');
}

export function renderDigest(pdfPath: string, threads: PdfThreads): string {
	const header = `> Generated from the comments on [[${pdfPath}]]. Edits here are overwritten: comment in the PDF view.`;
	const entries = Object.entries(threads);
	if (!entries.length) return header;
	const byPage = new Map<number, [string, PdfThread][]>();
	const detached: [string, PdfThread][] = [];
	for (const [id, t] of entries) {
		const a = threadAnchor(t);
		if (!a || t.detached) detached.push([id, t]);
		else {
			const p = a.segments[0]!.page;
			if (!byPage.has(p)) byPage.set(p, []);
			byPage.get(p)!.push([id, t]);
		}
	}
	const parts: string[] = [header];
	for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
		const list = byPage.get(page)!;
		list.sort(([, a], [, b]) => Number(a.resolved) - Number(b.resolved) || compareAnchors(threadAnchor(a)!, threadAnchor(b)!));
		parts.push(`## Page ${page}`);
		for (const [id, t] of list) parts.push(renderThread(pdfPath, id, t));
	}
	if (detached.length) {
		detached.sort(([, a], [, b]) => a.created.localeCompare(b.created));
		parts.push('## Detached', '*The passages of these comments were not found in the current version of the PDF.*');
		for (const [id, t] of detached) parts.push(renderThread(pdfPath, id, t));
	}
	return parts.join('\n\n');
}
