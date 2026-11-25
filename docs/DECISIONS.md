# Decisions

Decisions that fill gaps in, or deviate from, `docs/SPEC.md`. Newest last. Evidence for Phase 0 decisions is in `docs/RESEARCH.md`.

## Phase 0

**D0.1 — How the plugin gets the PDF.js viewer.** `loadPdfJs()` only loads `pdfjsLib`; `pdfjsViewer` exists only after Obsidian's own PDF view has opened. The plugin loads Obsidian's own viewer build (`/lib/pdfjs/pdf.viewer.min.mjs`, a module script) when `window.pdfjsViewer` is missing, once, and waits for it. Reason: it matches Obsidian's `pdfjsLib` exactly and gives the `data-idx` text layer that Obsidian's selection links use; tested on Electron 40 with no built-in view opened. Bundling `pdfjs-dist` stays the fallback if that path ever disappears (check at load: missing `PDFViewer`, or `pdfjsLib.version` other than the one tested → clear notice).

**D0.2 — Page text and offsets.** Page text = `getTextContent()` items (default options) joined in order, with `"\n"` after each `hasEOL` item. Anchors store offsets into it. A DOM selection maps to (item index from `data-idx`, char offset), then to page-text offsets. Unicode normalisation is applied only for searching quotes (re-anchoring), never to the stored offsets, so offsets always match `data-idx` positions.

**D0.3 — Test PDFs are generated with Typst, protected copy with qpdf.** Both are in the flake dev shell. Reason: real text, outline, footnotes, internal and external links, two columns, a figure, a ~300-page book, and a "revised" version with shifted text, from small sources in git; no binaries from the internet. Generated PDFs are git-ignored.

**D0.4 — Harness port 9335.** Docs uses 9333; both harnesses can run at once. `OBSIDIAN_ELECTRON` runs the harness on another Electron (e.g. 40) to check the plugin where the built-in view is blank.

**D0.5 — Obsidian-compatible links.** `#page=N&selection=a,b,c,d` (item index, offset, item index, offset; verified in 1.15.1) opens in our view with that text flashed; "copy link to comment" writes `#page=N&selection=…&comment=ID` so the link also works in the built-in view (it ignores `comment`). Obsidian 1.8.0's off-by-one is ignored (minAppVersion can move past it if needed).
