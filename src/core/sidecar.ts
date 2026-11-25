// The comment note of a PDF (SPEC §5.1, §5.2). Pure TypeScript.
//
//   ---
//   commented-pdf: "[[Papers/Smith 2021.pdf]]"
//   commented-pdf-fingerprint: "a1b2…"
//   (other properties you add are kept)
//   ---
//   (generated digest, digest.ts)
//
//   <!--pdf-comments:threads
//   { ...pretty JSON, one thread per key... }
//   -->
//
// The JSON block is the only data; everything between the properties and the block is
// generated from it on every save. Thread and comment fields are those of the Docs plugin
// (shared/model.ts) plus `anchor` (anchor.ts) and `detached`. Unknown fields are kept.
// `-->` never appears inside the block: it is written as `-->`, which JSON.parse decodes.

import type { Comment, Thread } from './shared/model';
import { validAnchor, type Anchor } from './anchor';

export const BLOCK_OPEN = '<!--pdf-comments:threads';
export const BLOCK_CLOSE = '-->';
/** Specific names, so they can't be confused with other notes' properties (DECISIONS F1.6). */
export const PDF_KEY = 'commented-pdf';
export const FINGERPRINT_KEY = 'commented-pdf-fingerprint';
/** Names of builds before 0.2: still read (in notes with the data block), replaced on the next write. */
export const LEGACY_PDF_KEY = 'pdf';
export const LEGACY_FINGERPRINT_KEY = 'pdf-fingerprint';
const OWN_KEYS = [PDF_KEY, FINGERPRINT_KEY, LEGACY_PDF_KEY, LEGACY_FINGERPRINT_KEY];

export interface PdfThread extends Thread {
	/** Raw stored anchor; read it with `threadAnchor()` (a malformed one is kept, not shown). */
	anchor?: unknown;
	/** Set when the quote could not be found in the current PDF (shown under "Detached"). */
	detached?: boolean;
}

export type PdfThreads = Record<string, PdfThread>;

export function threadAnchor(t: PdfThread): Anchor | null {
	return validAnchor(t.anchor);
}

// ---- Frontmatter --------------------------------------------------------------

interface Frontmatter {
	/** Lines between the `---` fences, as written. */
	lines: string[];
	/** Offset just after the closing fence line. */
	end: number;
}

function readFrontmatter(md: string): Frontmatter | null {
	const m = /^---\r?\n([\s\S]*?\r?\n)?---[ \t]*(\r?\n|$)/.exec(md);
	if (!m) return null;
	const body = m[1] ?? '';
	return { lines: body === '' ? [] : body.replace(/\r?\n$/, '').split(/\r?\n/), end: m[0].length };
}

/** The scalar value of a top-level `key:` line (quotes removed), or null. */
function readKey(lines: string[], key: string): string | null {
	const re = new RegExp(`^${key.replace(/[-]/g, '\\-')}:[ \\t]*(.*)$`);
	for (const l of lines) {
		const m = re.exec(l);
		if (!m) continue;
		const v = m[1]!.trim();
		if (v.startsWith('"')) {
			try {
				return JSON.parse(v) as string;
			} catch {
				return v.slice(1, -1);
			}
		}
		if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
		return v;
	}
	return null;
}

/** `[[Papers/Smith 2021.pdf|alias]]` / `[[…#page=2]]` / a plain path → the link path. */
export function parsePdfLink(value: string | null | undefined): string | null {
	if (!value) return null;
	let v = value.trim();
	const m = /^!?\[\[([^\]]+)\]\]$/.exec(v);
	if (m) v = m[1]!;
	v = v.split('|')[0]!.split('#')[0]!.trim();
	return v || null;
}

export function pdfLinkValue(pdfPath: string): string {
	return `[[${pdfPath}]]`;
}

// ---- Block -------------------------------------------------------------------

export interface ThreadBlockPos {
	from: number;
	to: number;
	json: string;
}

/** The last `<!--pdf-comments:threads` block at a line start. */
export function findThreadBlock(md: string): ThreadBlockPos | null {
	let idx = md.lastIndexOf(BLOCK_OPEN);
	while (idx > 0 && md[idx - 1] !== '\n') idx = md.lastIndexOf(BLOCK_OPEN, idx - 1);
	if (idx === -1) return null;
	const jsonStart = idx + BLOCK_OPEN.length;
	const close = md.indexOf(BLOCK_CLOSE, jsonStart);
	if (close === -1) return null;
	return { from: idx, to: close + BLOCK_CLOSE.length, json: md.slice(jsonStart, close).trim() };
}

function asString(v: unknown, fallback = ''): string {
	return typeof v === 'string' ? v : fallback;
}

function normalizeComment(raw: unknown, i: number): Comment | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	const c: Comment = { ...r, id: asString(r.id, 'a' + (i + 1)), parent: typeof r.parent === 'string' ? r.parent : null, created: asString(r.created), body: asString(r.body) };
	if (typeof r.edited !== 'string') delete c.edited;
	return c;
}

function normalizeThread(raw: unknown): PdfThread | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	const comments = Array.isArray(r.comments) ? r.comments.map(normalizeComment).filter((c): c is Comment => c !== null) : [];
	const t: PdfThread = { ...r, quote: asString(r.quote), created: asString(r.created, comments[0]?.created ?? ''), resolved: r.resolved === true, comments };
	if (typeof r.resolvedAt !== 'string') delete t.resolvedAt;
	if (r.detached !== true) delete t.detached;
	return t;
}

export interface SidecarData {
	/** Link path from the `pdf` property (resolve it with Obsidian's metadata cache). */
	pdfLink: string | null;
	fingerprint: string | null;
	threads: PdfThreads;
}

export type SidecarParse = { ok: true; data: SidecarData } | { ok: false; error: string };

/** Reads a comment note. A malformed block gives ok:false, and the note must then not be overwritten. */
export function parseSidecar(md: string): SidecarParse {
	const fm = readFrontmatter(md);
	const pdfLink = fm ? parsePdfLink(readKey(fm.lines, PDF_KEY) ?? readKey(fm.lines, LEGACY_PDF_KEY)) : null;
	const fingerprint = fm ? readKey(fm.lines, FINGERPRINT_KEY) || readKey(fm.lines, LEGACY_FINGERPRINT_KEY) || null : null;
	const block = findThreadBlock(md);
	const threads: PdfThreads = {};
	if (block) {
		let data: unknown;
		try {
			data = block.json === '' ? {} : JSON.parse(block.json);
		} catch (e) {
			return { ok: false, error: `Comment data is not valid JSON: ${(e as Error).message}` };
		}
		if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'Comment data must be a JSON object' };
		for (const [id, raw] of Object.entries(data as Record<string, unknown>)) {
			const t = normalizeThread(raw);
			if (t) threads[id] = t;
		}
	}
	return { ok: true, data: { pdfLink, fingerprint, threads } };
}

const THREAD_KEYS = ['anchor', 'quote', 'created', 'resolved', 'resolvedAt', 'detached', 'comments'];
const COMMENT_KEYS = ['id', 'parent', 'created', 'edited', 'body'];
const ANCHOR_KEYS = ['segments', 'prefix', 'suffix', 'area'];
const SEGMENT_KEYS = ['page', 'start', 'end', 'rects'];

function orderedEntries(obj: Record<string, unknown>, known: string[]): [string, unknown][] {
	const out: [string, unknown][] = [];
	for (const k of known) if (obj[k] !== undefined) out.push([k, obj[k]]);
	for (const [k, v] of Object.entries(obj)) if (!known.includes(k) && v !== undefined) out.push([k, v]);
	return out;
}

function inline(obj: Record<string, unknown>, known: string[]): string {
	return `{ ${orderedEntries(obj, known)
		.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`)
		.join(', ')} }`;
}

function serializeAnchor(raw: unknown): string {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return JSON.stringify(raw);
	const fields = orderedEntries(raw as Record<string, unknown>, ANCHOR_KEYS).map(([k, v]) => {
		if (k === 'segments' && Array.isArray(v)) {
			const segs = v.map((s) => '        ' + (s && typeof s === 'object' && !Array.isArray(s) ? inline(s as Record<string, unknown>, SEGMENT_KEYS) : JSON.stringify(s)));
			return `      "segments": [\n${segs.join(',\n')}\n      ]`;
		}
		return `      ${JSON.stringify(k)}: ${JSON.stringify(v)}`;
	});
	return `{\n${fields.join(',\n')}\n    }`;
}

/** Escape sequences that would end an HTML comment early. */
export function escapeBlockText(s: string): string {
	return s.replace(/--(!?)>/g, '--$1\\u003e');
}

/** The block's JSON: one thread per key, one comment and one anchor segment per line. */
export function serializeThreadJson(threads: PdfThreads): string {
	const ids = Object.keys(threads);
	if (!ids.length) return '{}';
	const parts = ids.map((id) => {
		const t = threads[id]!;
		const fields = orderedEntries(t as Record<string, unknown>, THREAD_KEYS).map(([k, v]) => {
			if (k === 'comments') {
				const cs = (v as Comment[]).map((c) => `      ${inline(c as Record<string, unknown>, COMMENT_KEYS)}`);
				return cs.length ? `    "comments": [\n${cs.join(',\n')}\n    ]` : `    "comments": []`;
			}
			if (k === 'anchor') return `    "anchor": ${serializeAnchor(v)}`;
			return `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`;
		});
		return `  ${JSON.stringify(id)}: {\n${fields.join(',\n')}\n  }`;
	});
	return escapeBlockText(`{\n${parts.join(',\n')}\n}`);
}

export interface SidecarWrite {
	pdfPath: string;
	fingerprint: string | null;
	threads: PdfThreads;
	/** The generated body (digest.ts). */
	digest: string;
}

/**
 * The full text of a comment note. Properties other than ours (and their pre-0.2 names) in
 * `existing` are kept as they are; the body is replaced by the digest and the block.
 */
export function buildSidecar(existing: string | null, w: SidecarWrite): string {
	const fm = existing ? readFrontmatter(existing) : null;
	const keep = (fm?.lines ?? []).filter((l, i, all) => !ownKeyLine(l) && !continuesOwnKey(all, i));
	const own = [`${PDF_KEY}: ${JSON.stringify(pdfLinkValue(w.pdfPath))}`];
	if (w.fingerprint) own.push(`${FINGERPRINT_KEY}: ${JSON.stringify(w.fingerprint)}`);
	const props = ['---', ...own, ...keep, '---'].join('\n');
	const digest = w.digest.trim();
	return `${props}\n${digest ? digest + '\n\n' : ''}${BLOCK_OPEN}\n${serializeThreadJson(w.threads)}\n${BLOCK_CLOSE}\n`;
}

function ownKeyLine(l: string): boolean {
	return OWN_KEYS.some((k) => l.startsWith(k + ':'));
}

/** Indented lines (a YAML list or block) under one of our keys belong to it and are replaced too. */
function continuesOwnKey(lines: string[], i: number): boolean {
	if (!/^\s/.test(lines[i]!)) return false;
	for (let j = i - 1; j >= 0; j--) if (!/^\s/.test(lines[j]!)) return ownKeyLine(lines[j]!);
	return false;
}

/** The generated part of a note: between the properties and the block (trimmed). */
export function sidecarBody(md: string): string {
	const fm = readFrontmatter(md);
	const block = findThreadBlock(md);
	return md.slice(fm?.end ?? 0, block?.from ?? md.length).trim();
}
