// Access to the PDF.js that Obsidian ships (SPEC §2.2, DECISIONS D0.1).
//
// `loadPdfJs()` (public API) gives `pdfjsLib`. The viewer components
// (`pdfjsViewer`: PDFViewer, EventBus, …) are only loaded by Obsidian when its
// own PDF view first opens, so we load the same file ourselves if needed. It is
// Obsidian's own build, so it always matches its `pdfjsLib`.
// The `pdfjs-dist` package is used for types only (nothing from it is bundled).

import { loadPdfJs } from 'obsidian';
import type * as PdfjsLib from 'pdfjs-dist';
import type * as PdfjsViewer from 'pdfjs-dist/types/web/pdf_viewer.component';

export type { PdfjsLib, PdfjsViewer };
export type PDFDocumentProxy = PdfjsLib.PDFDocumentProxy;
export type PDFViewer = PdfjsViewer.PDFViewer;
export type EventBus = PdfjsViewer.EventBus;
export type PDFLinkService = PdfjsViewer.PDFLinkService;
export type PDFFindController = PdfjsViewer.PDFFindController;
export type PDFPageView = PdfjsViewer.PDFPageView;

export interface PdfJs {
	lib: typeof PdfjsLib;
	viewer: typeof PdfjsViewer;
}

/** The version this plugin was tested with; others work but are reported once in the console. */
export const TESTED_PDFJS_VERSION = '5.3.34';
const VIEWER_SRC = '/lib/pdfjs/pdf.viewer.min.mjs';

type PdfWindow = Window & { pdfjsLib?: typeof PdfjsLib; pdfjsViewer?: typeof PdfjsViewer };

let loading: Promise<PdfJs> | null = null;

export function loadPdfJsWithViewer(): Promise<PdfJs> {
	if (!loading) {
		loading = load().catch((e: unknown) => {
			loading = null; // allow a retry
			throw e;
		});
	}
	return loading;
}

async function load(): Promise<PdfJs> {
	const w = window as PdfWindow;
	const lib = ((await loadPdfJs()) as typeof PdfjsLib | undefined) ?? w.pdfjsLib;
	if (!lib) throw new Error('PDF.js could not be loaded');
	if (!w.pdfjsViewer) await injectViewerScript();
	const viewer = w.pdfjsViewer;
	if (!viewer?.PDFViewer || !viewer.EventBus || !viewer.PDFLinkService) {
		throw new Error('This Obsidian version does not provide the PDF.js viewer components');
	}
	if (lib.version !== TESTED_PDFJS_VERSION) {
		console.debug(`[pdf-comments] PDF.js ${lib.version} (tested with ${TESTED_PDFJS_VERSION})`);
	}
	return { lib, viewer };
}

function injectViewerScript(): Promise<void> {
	return new Promise((resolve, reject) => {
		// The main window on purpose: PDF.js defines window globals there, which every view uses.
		const script = document.head.createEl('script', { attr: { type: 'module', src: VIEWER_SRC } });
		script.addEventListener('load', () => resolve(), { once: true });
		script.addEventListener('error', () => reject(new Error(`Could not load ${VIEWER_SRC}`)), { once: true });
	});
}
