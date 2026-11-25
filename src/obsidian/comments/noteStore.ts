// Finding, reading and writing the comment note of each PDF (SPEC §5.1, DECISIONS D3.2–D3.4).
//
// The note is tied to its PDF by its `commented-pdf` property (a link), so an index PDF path → note is kept
// from Obsidian's metadata cache. A note only counts as a comment note if it also contains the
// data block: a note of yours that merely has such a property (or `pdf`, the name before 0.2) is
// never read as one, and never written. Notes are written with `vault.process` from the note's current text, so an edit made
// elsewhere a moment earlier (sync, another device) is not lost.

import { normalizePath, TFile, TFolder, type App } from 'obsidian';
import { BLOCK_OPEN, buildSidecar, LEGACY_PDF_KEY, parsePdfLink, PDF_KEY, parseSidecar, sidecarBody, type PdfThreads } from '../../core/sidecar';
import { renderDigest } from '../../core/digest';
import { normalizeFolder, sidecarPathFor } from '../../core/sidecarName';

export interface NoteState {
	note: TFile | null;
	threads: PdfThreads;
	fingerprint: string | null;
	/** The note's data block is malformed: show the error and never write. */
	error: string | null;
}

export interface NoteStoreHost {
	app: App;
	folder(): string;
	renameNotesWithPdfs(): boolean;
	/** A comment note changed outside this plugin (sync, manual edit) or was deleted. */
	noteChanged(pdfPath: string): void;
	/** The user's edits to a digest were overwritten (once per note and session). */
	digestOverwritten(note: TFile): void;
}

export class NoteStore {
	/** PDF path → note path, for notes with a `pdf` property (not yet checked for the block). */
	private byPdf = new Map<string, string>();
	private pdfOf = new Map<string, string>();
	/** Text last written per note path, so our own writes are not taken for outside changes. */
	private written = new Map<string, string>();
	private warnedDigest = new Set<string>();
	/** Notes with a `pdf` property but no data block: yours, never used as comment notes. */
	private notOurs = new Set<string>();

	constructor(private host: NoteStoreHost) {}

	private get app(): App {
		return this.host.app;
	}

	// ---- Index ----------------------------------------------------------------------

	rebuild(): void {
		this.byPdf.clear();
		this.pdfOf.clear();
		for (const f of this.app.vault.getMarkdownFiles()) this.index(f);
	}

	/** (Re)indexes one Markdown file; returns the PDF path it points to, if any. */
	index(file: TFile): string | null {
		if (this.notOurs.has(file.path)) return null;
		const old = this.pdfOf.get(file.path);
		if (old && this.byPdf.get(old) === file.path) this.byPdf.delete(old);
		this.pdfOf.delete(file.path);
		const fm: Record<string, unknown> | undefined = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const raw = fm?.[PDF_KEY] ?? fm?.[LEGACY_PDF_KEY]; // the old name only counts with the data block (commentNote)
		const link = parsePdfLink(typeof raw === 'string' ? raw : null);
		if (!link) return null;
		const pdf = this.app.metadataCache.getFirstLinkpathDest(link, file.path);
		if (!pdf || pdf.extension !== 'pdf') return null;
		// Two notes for one PDF: the one in the comments folder wins, then the first seen.
		const existing = this.byPdf.get(pdf.path);
		if (existing && existing !== file.path && this.inFolder(existing) && !this.inFolder(file.path)) return null;
		this.byPdf.set(pdf.path, file.path);
		this.pdfOf.set(file.path, pdf.path);
		return pdf.path;
	}

	forget(notePath: string): string | null {
		this.notOurs.delete(notePath);
		const pdf = this.pdfOf.get(notePath) ?? null;
		this.pdfOf.delete(notePath);
		if (pdf && this.byPdf.get(pdf) === notePath) this.byPdf.delete(pdf);
		this.written.delete(notePath);
		return pdf;
	}

	pdfForNote(notePath: string): string | null {
		return this.pdfOf.get(notePath) ?? null;
	}

	noteFileFor(pdfPath: string): TFile | null {
		const p = this.byPdf.get(pdfPath);
		const f = p ? this.app.vault.getAbstractFileByPath(p) : null;
		return f instanceof TFile ? f : null;
	}

	private inFolder(path: string): boolean {
		const dir = normalizeFolder(this.host.folder());
		return dir === '' ? !path.includes('/') : path.startsWith(dir + '/');
	}

	/** Was this change of a note made by us? (Then views need not reload.) */
	isOwnWrite(file: TFile, text: string): boolean {
		return this.written.get(file.path) === text;
	}

	// ---- Read -----------------------------------------------------------------------

	/**
	 * The PDF's comment note, checked for the data block. A note that only has a `pdf` property
	 * is set aside for good (and the index forgets it), so a comment note is created instead.
	 */
	private async commentNote(pdfPath: string): Promise<{ note: TFile; text: string } | null> {
		for (;;) {
			const note = this.noteFileFor(pdfPath);
			if (!note) return null;
			const text = await this.app.vault.read(note);
			if (text.includes(BLOCK_OPEN)) return { note, text };
			this.forget(note.path);
			this.notOurs.add(note.path);
			this.reindexPdf(pdfPath);
		}
	}

	/** Looks for another note pointing at the PDF (after one was set aside). */
	private reindexPdf(pdfPath: string): void {
		for (const f of this.app.vault.getMarkdownFiles()) if (!this.notOurs.has(f.path) && this.pdfOf.get(f.path) === undefined && this.index(f) === pdfPath) return;
	}

	async read(pdfPath: string): Promise<NoteState> {
		const found = await this.commentNote(pdfPath);
		if (!found) return { note: null, threads: {}, fingerprint: null, error: null };
		const { note, text } = found;
		const p = parseSidecar(text);
		if (!p.ok) return { note, threads: {}, fingerprint: null, error: `${note.path}: ${p.error}` };
		return { note, threads: p.data.threads, fingerprint: p.data.fingerprint, error: null };
	}

	// ---- Write ----------------------------------------------------------------------

	/**
	 * Applies `fn` to the note's current threads and writes the note (creating it on the first
	 * comment). `fingerprint` replaces the stored one when given. Returns the new threads.
	 */
	async update(pdf: TFile, fn: (threads: PdfThreads) => PdfThreads, fingerprint?: string | null): Promise<PdfThreads> {
		const note = (await this.commentNote(pdf.path))?.note ?? null;
		if (note) {
			let result: PdfThreads = {};
			let digestEdited = false;
			const text = await this.app.vault.process(note, (md) => {
				if (!md.includes(BLOCK_OPEN)) throw new Error(`${note.path} points at a PDF but is not a comment note; not changing it`);
				const p = parseSidecar(md);
				if (!p.ok) throw new Error(`${note.path}: ${p.error}`);
				result = fn(p.data.threads);
				digestEdited = sidecarBody(md) !== renderDigest(pdf.path, p.data.threads).trim();
				const fp = fingerprint === undefined ? p.data.fingerprint : fingerprint;
				return buildSidecar(md, { pdfPath: pdf.path, fingerprint: fp, threads: result, digest: renderDigest(pdf.path, result) });
			});
			this.written.set(note.path, text);
			if (digestEdited && !this.warnedDigest.has(note.path)) {
				this.warnedDigest.add(note.path);
				this.host.digestOverwritten(note);
			}
			return result;
		}
		const threads = fn({});
		if (!Object.keys(threads).length) return threads;
		const folder = normalizeFolder(this.host.folder());
		if (folder) await this.ensureFolder(folder);
		const path = normalizePath(sidecarPathFor(pdf.path, folder, (p) => this.app.vault.getAbstractFileByPath(p) !== null));
		const text = buildSidecar(null, { pdfPath: pdf.path, fingerprint: fingerprint ?? null, threads, digest: renderDigest(pdf.path, threads) });
		this.written.set(path, text);
		const file = await this.app.vault.create(path, text);
		this.byPdf.set(pdf.path, file.path);
		this.pdfOf.set(file.path, pdf.path);
		return threads;
	}

	private async ensureFolder(folder: string): Promise<void> {
		let path = '';
		for (const part of folder.split('/')) {
			path = path ? `${path}/${part}` : part;
			const f = this.app.vault.getAbstractFileByPath(path);
			if (f instanceof TFolder) continue;
			if (f) throw new Error(`${path} is a file, not a folder`);
			await this.app.vault.createFolder(path);
		}
	}

	// ---- PDF renamed --------------------------------------------------------------------

	/** Follows a PDF rename: index, the note's `pdf` property, and (setting) the note's name. */
	async pdfRenamed(pdf: TFile, oldPath: string): Promise<void> {
		const notePath = this.byPdf.get(oldPath);
		if (!notePath) return;
		this.byPdf.delete(oldPath);
		this.byPdf.set(pdf.path, notePath);
		this.pdfOf.set(notePath, pdf.path);
		const note = this.app.vault.getAbstractFileByPath(notePath);
		if (!(note instanceof TFile)) return;
		const text = await this.app.vault.read(note);
		if (!text.includes(BLOCK_OPEN)) return;
		// Obsidian may already have updated the link; rewriting with the same threads is harmless.
		await this.update(pdf, (t) => t);
		if (!this.host.renameNotesWithPdfs() || !this.inFolder(note.path)) return;
		const target = normalizePath(sidecarPathFor(pdf.path, normalizeFolder(this.host.folder()), (p) => p !== note.path && this.app.vault.getAbstractFileByPath(p) !== null));
		if (target === note.path) return;
		const from = note.path;
		await this.app.fileManager.renameFile(note, target);
		this.pdfOf.delete(from);
		this.pdfOf.set(note.path, pdf.path);
		this.byPdf.set(pdf.path, note.path);
		const w = this.written.get(from);
		if (w !== undefined) this.written.set(note.path, w);
	}
}
