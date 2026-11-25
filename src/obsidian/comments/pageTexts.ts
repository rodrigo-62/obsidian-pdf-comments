// Text of a loaded PDF's pages, as core/pageText.ts and core/anchor.ts need it. Loaded lazily
// per page and kept while the document is open.

import { buildPageText } from '../../core/pageText';
import type { TextItemGeom } from '../../core/anchor';
import type { PageData } from '../../core/reanchor';
import type { PDFDocumentProxy } from '../pdfjs';

export class PageTexts {
	private pages = new Map<number, Promise<PageData>>();

	constructor(private doc: PDFDocumentProxy) {}

	get numPages(): number {
		return this.doc.numPages;
	}

	get(page: number): Promise<PageData> {
		let p = this.pages.get(page);
		if (!p) {
			p = (async () => {
				const pg = await this.doc.getPage(page);
				const tc = await pg.getTextContent();
				// Default options: no marked-content items, so indices are the text layer's data-idx.
				const items = tc.items.filter((it): it is typeof it & TextItemGeom => 'str' in it) as unknown as TextItemGeom[];
				return { text: buildPageText(items), items };
			})();
			this.pages.set(page, p);
			p.catch(() => this.pages.delete(page));
		}
		return p;
	}

	async all(): Promise<PageData[]> {
		const out: PageData[] = [];
		for (let i = 1; i <= this.doc.numPages; i++) out.push(await this.get(i));
		return out;
	}
}
