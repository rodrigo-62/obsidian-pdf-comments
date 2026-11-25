// Writes the text items of test PDFs to tests/fixtures/*.json (committed), so core tests run on
// real PDF.js output without needing Typst or the generated PDFs. Run after `npm run vault:reset`:
//   node scripts/extract-text-fixture.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const FIXTURES = {
	'lighthouses-v1': 'test-vault/PDFs/Lighthouses.pdf',
	'lighthouses-v2': 'test-vault/PDFs/Lighthouses (revised).pdf',
	'two-column': 'test-vault/PDFs/Two-column paper.pdf',
};
const round = (n) => Math.round(n * 1000) / 1000;
mkdirSync('tests/fixtures', { recursive: true });
for (const [name, path] of Object.entries(FIXTURES)) {
	const doc = await getDocument({ data: new Uint8Array(readFileSync(path)), verbosity: 0 }).promise;
	const pages = [];
	for (let p = 1; p <= doc.numPages; p++) {
		const page = await doc.getPage(p);
		const tc = await page.getTextContent();
		pages.push({
			view: page.view.map(round),
			items: tc.items.map((it) => ({ str: it.str, hasEOL: it.hasEOL, transform: it.transform.map(round), width: round(it.width), height: round(it.height) })),
		});
	}
	writeFileSync(`tests/fixtures/${name}.json`, JSON.stringify({ source: path, fingerprint: doc.fingerprints[0], pages }));
	console.log(`tests/fixtures/${name}.json: ${pages.length} pages, ${pages.reduce((n, p) => n + p.items.length, 0)} items`);
}
